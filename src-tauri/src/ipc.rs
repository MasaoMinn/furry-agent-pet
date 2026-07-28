use std::{
    collections::VecDeque,
    env, io,
    pin::Pin,
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{App, AppHandle, Emitter, Manager, State};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    sync::{oneshot, watch, Notify},
    time::{sleep, sleep_until, Instant},
};

use crate::{
    protocol::{DecodeError, JsonLinesDecoder, StateEvent},
    state_normalizer::StateEventNormalizer,
};

const AGENT_STATE_EVENT: &str = "agent-state";
const CONNECTION_STATUS_EVENT: &str = "connection-status";
const ENV_IPC_PATH: &str = "FURRY_COMPANION_IPC_PATH";
const MAX_ENDPOINT_CHARS: usize = 4_096;
const INITIAL_BACKOFF: Duration = Duration::from_secs(1);
const MAX_BACKOFF: Duration = Duration::from_secs(30);
const STABLE_CONNECTION_RESET: Duration = Duration::from_secs(30);
const COALESCED_STATUS_INTERVAL_MS: u64 = 1_000;
const MAX_PENDING_PUBLICATIONS: usize = 64;

type IpcStream = Pin<Box<dyn AsyncRead + Send>>;

#[derive(Debug, Clone, Copy)]
struct ReconnectBackoff {
    delay: Duration,
}

impl Default for ReconnectBackoff {
    fn default() -> Self {
        Self {
            delay: INITIAL_BACKOFF,
        }
    }
}

impl ReconnectBackoff {
    fn delay(self) -> Duration {
        self.delay
    }

    fn reset(&mut self) {
        self.delay = INITIAL_BACKOFF;
    }

    fn advance(&mut self) {
        self.delay = (self.delay * 2).min(MAX_BACKOFF);
    }
}

fn should_reset_backoff(received_valid_event: bool, connected_for: Duration) -> bool {
    received_valid_event || connected_for >= STABLE_CONNECTION_RESET
}

#[derive(Debug, Clone, Default)]
struct IpcConfig {
    address: Option<String>,
    // The settings backend owns the persisted preference. The frontend submits
    // the Rust-normalized value after Store + pet package initialization. The
    // bool default keeps startup paused, avoiding a transient connection to the
    // platform endpoint when the persisted preference disables or redirects IPC.
    enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    Connecting,
    Connected,
    Disconnected,
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    revision: u64,
    status: ConnectionStatus,
    endpoint: String,
    last_event_at_ms: Option<u64>,
    last_error: Option<String>,
}

struct RuntimeInner {
    config: Mutex<IpcConfig>,
    commit: Mutex<CommitState>,
    dispatch: Mutex<DispatchCursor>,
    publication_wake: Notify,
    wake: watch::Sender<u64>,
}

struct CommitState {
    generation: u64,
    publication_sequence: u64,
    publications: VecDeque<Publication>,
    snapshot: RuntimeSnapshot,
    last_status_emit_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Publication {
    generation: u64,
    sequence: u64,
    agent_event: Option<StateEvent>,
    snapshot: RuntimeSnapshot,
}

#[derive(Debug, Default)]
struct DispatchCursor {
    generation: u64,
    sequence: u64,
}

#[derive(Clone)]
pub struct IpcRuntime {
    inner: Arc<RuntimeInner>,
}

impl IpcRuntime {
    fn new() -> (Self, watch::Receiver<u64>) {
        let config = IpcConfig::default();
        let endpoint = resolve_endpoint(&config);
        let (wake, receiver) = watch::channel(0);
        let runtime = Self {
            inner: Arc::new(RuntimeInner {
                config: Mutex::new(config),
                commit: Mutex::new(CommitState {
                    generation: 0,
                    publication_sequence: 0,
                    publications: VecDeque::new(),
                    snapshot: RuntimeSnapshot {
                        revision: 0,
                        status: ConnectionStatus::Disabled,
                        endpoint,
                        last_event_at_ms: None,
                        last_error: None,
                    },
                    last_status_emit_at_ms: 0,
                }),
                dispatch: Mutex::new(DispatchCursor::default()),
                publication_wake: Notify::new(),
                wake,
            }),
        };
        (runtime, receiver)
    }

    fn config(&self) -> IpcConfig {
        lock(&self.inner.config).clone()
    }

    fn snapshot(&self) -> RuntimeSnapshot {
        lock(&self.inner.commit).snapshot.clone()
    }

    fn generation(&self) -> u64 {
        lock(&self.inner.commit).generation
    }

    fn with_current_generation<R>(
        &self,
        generation: u64,
        commit: impl FnOnce(&mut CommitState) -> R,
    ) -> Option<R> {
        let mut state = lock(&self.inner.commit);
        if state.generation != generation {
            return None;
        }

        Some(commit(&mut state))
    }

    fn with_control_change<R>(&self, commit: impl FnOnce(u64, &mut CommitState) -> R) -> (u64, R) {
        let mut state = lock(&self.inner.commit);
        state.generation = state.generation.wrapping_add(1);
        state.publication_sequence = 0;
        state.publications.clear();
        let generation = state.generation;
        let result = commit(generation, &mut state);

        // Notify the supervisor only after the command's snapshot and local
        // events have committed. A woken supervisor must acquire this same
        // gate before it can publish for the new generation.
        self.inner.wake.send_replace(generation);
        (generation, result)
    }

    fn enqueue_publication(
        &self,
        state: &mut CommitState,
        agent_event: Option<StateEvent>,
    ) -> Publication {
        let replace_tail = state.publications.len() >= MAX_PENDING_PUBLICATIONS;
        let sequence = if replace_tail {
            state
                .publications
                .back()
                .expect("a full publication queue must have a tail")
                .sequence
        } else {
            state.publication_sequence = state.publication_sequence.wrapping_add(1);
            state.publication_sequence
        };
        let publication = Publication {
            generation: state.generation,
            sequence,
            agent_event,
            snapshot: state.snapshot.clone(),
        };
        if replace_tail {
            *state
                .publications
                .back_mut()
                .expect("a full publication queue must have a tail") = publication.clone();
        } else {
            state.publications.push_back(publication.clone());
        }
        self.inner.publication_wake.notify_one();
        publication
    }

    fn take_publication(&self) -> Option<Publication> {
        lock(&self.inner.commit).publications.pop_front()
    }

    async fn next_publication(&self) -> Publication {
        loop {
            let notified = self.inner.publication_wake.notified();
            if let Some(publication) = self.take_publication() {
                return publication;
            }
            notified.await;
        }
    }

    fn claim_publication(&self, publication: &Publication) -> bool {
        let committed = lock(&self.inner.commit);
        if committed.generation != publication.generation {
            return false;
        }

        let mut cursor = lock(&self.inner.dispatch);
        if cursor.generation != publication.generation {
            cursor.generation = publication.generation;
            cursor.sequence = 0;
        }
        if publication.sequence != cursor.sequence.wrapping_add(1) {
            return false;
        }

        cursor.sequence = publication.sequence;
        drop(cursor);
        drop(committed);
        true
    }

    fn update_snapshot(
        state: &mut CommitState,
        status: ConnectionStatus,
        endpoint: String,
        last_error: Option<String>,
    ) -> RuntimeSnapshot {
        state.snapshot.revision = state.snapshot.revision.saturating_add(1);
        state.snapshot.status = status;
        state.snapshot.endpoint = endpoint;
        state.snapshot.last_error = last_error;
        state.snapshot.clone()
    }

    fn commit_control_change(&self, config_update: Option<IpcConfig>) -> RuntimeSnapshot {
        self.with_control_change(|_, state| {
            let config = {
                let mut config = lock(&self.inner.config);
                if let Some(config_update) = config_update {
                    *config = config_update;
                }
                config.clone()
            };
            let status = if config.enabled {
                ConnectionStatus::Connecting
            } else {
                ConnectionStatus::Disabled
            };
            let snapshot = Self::update_snapshot(state, status, resolve_endpoint(&config), None);
            state.last_status_emit_at_ms = now_ms();
            self.enqueue_publication(state, None);
            snapshot
        })
        .1
    }

    async fn publish_control_change(
        &self,
        app: &AppHandle,
        config_update: Option<IpcConfig>,
    ) -> RuntimeSnapshot {
        let runtime = self.clone();
        // Control commits and UI dispatch claims are both serialized by the
        // main event loop. Awaiting a one-shot result never blocks that loop.
        let (result, receiver) = oneshot::channel();
        if app
            .run_on_main_thread(move || {
                let snapshot = runtime.commit_control_change(config_update);
                let _ = result.send(snapshot);
            })
            .is_err()
        {
            return self.snapshot();
        }

        receiver.await.unwrap_or_else(|_| self.snapshot())
    }

    fn publish_if_current(
        &self,
        generation: u64,
        status: ConnectionStatus,
        endpoint: &str,
        last_error: Option<String>,
    ) -> bool {
        self.with_current_generation(generation, |state| {
            Self::update_snapshot(state, status, endpoint.to_owned(), last_error);
            state.last_status_emit_at_ms = now_ms();
            self.enqueue_publication(state, None);
        })
        .is_some()
    }

    fn publish_agent_event(&self, generation: u64, endpoint: &str, event: StateEvent) -> bool {
        self.with_current_generation(generation, |state| {
            let event_at_ms = now_ms();
            state.snapshot.revision = state.snapshot.revision.saturating_add(1);
            state.snapshot.status = ConnectionStatus::Connected;
            state.snapshot.endpoint = endpoint.to_owned();
            state.snapshot.last_event_at_ms = Some(event_at_ms);
            state.snapshot.last_error = None;
            state.last_status_emit_at_ms = event_at_ms;
            self.enqueue_publication(state, Some(event));
        })
        .is_some()
    }

    fn record_coalesced_agent_event(&self, generation: u64, endpoint: &str) -> bool {
        self.with_current_generation(generation, |state| {
            let event_at_ms = now_ms();
            let status_refresh_due =
                should_refresh_coalesced_status(state.last_status_emit_at_ms, event_at_ms);
            let recovered_from_diagnostic = state.snapshot.last_error.is_some();
            state.snapshot.status = ConnectionStatus::Connected;
            state.snapshot.endpoint = endpoint.to_owned();
            state.snapshot.last_event_at_ms = Some(event_at_ms);
            state.snapshot.last_error = None;

            if recovered_from_diagnostic || status_refresh_due {
                state.snapshot.revision = state.snapshot.revision.saturating_add(1);
                state.last_status_emit_at_ms = event_at_ms;
                self.enqueue_publication(state, None);
            }
        })
        .is_some()
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn emit_connection_snapshot(app: &AppHandle, snapshot: &RuntimeSnapshot) {
    crate::tray::update_connection_status(app, snapshot.status);
    let _ = app.emit(CONNECTION_STATUS_EVENT, snapshot);
}

async fn dispatch_publications(app: AppHandle, runtime: IpcRuntime) {
    loop {
        let publication = runtime.next_publication().await;
        let dispatch_app = app.clone();
        let dispatch_runtime = runtime.clone();
        let (completed, completion) = oneshot::channel();
        if app
            .run_on_main_thread(move || {
                // claim_publication releases every runtime lock before this
                // closure touches Tauri, the tray, or frontend event delivery.
                if dispatch_runtime.claim_publication(&publication) {
                    if let Some(event) = publication.agent_event {
                        let _ = dispatch_app.emit(AGENT_STATE_EVENT, &event);
                    }
                    emit_connection_snapshot(&dispatch_app, &publication.snapshot);
                }
                let _ = completed.send(());
            })
            .is_err()
        {
            return;
        }
        // Keep at most one main-thread publication in flight so the bounded
        // queue cannot merely migrate into an unbounded event-loop backlog.
        if completion.await.is_err() {
            return;
        }
    }
}

pub fn install(app: &App) {
    let (runtime, receiver) = IpcRuntime::new();
    app.manage(runtime.clone());

    let publication_app = app.handle().clone();
    let publication_runtime = runtime.clone();
    tauri::async_runtime::spawn(async move {
        dispatch_publications(publication_app, publication_runtime).await;
    });
    tauri::async_runtime::spawn(async move {
        supervise_connections(runtime, receiver).await;
    });
}

#[tauri::command]
pub fn get_runtime_snapshot(runtime: State<'_, IpcRuntime>) -> RuntimeSnapshot {
    runtime.snapshot()
}

#[tauri::command]
pub async fn set_ipc_config(
    app: AppHandle,
    address: String,
    enabled: bool,
) -> Result<RuntimeSnapshot, String> {
    let address = normalize_address(address)?;
    let runtime = app.state::<IpcRuntime>().inner().clone();
    Ok(runtime
        .publish_control_change(&app, Some(IpcConfig { address, enabled }))
        .await)
}

#[tauri::command]
pub async fn reconnect_ipc(app: AppHandle) -> RuntimeSnapshot {
    let runtime = app.state::<IpcRuntime>().inner().clone();
    reconnect_runtime(&app, &runtime).await
}

pub fn request_reconnect(app: &AppHandle) {
    let runtime = app.state::<IpcRuntime>().inner().clone();
    let _ = app.run_on_main_thread(move || {
        runtime.commit_control_change(None);
    });
}

async fn reconnect_runtime(app: &AppHandle, runtime: &IpcRuntime) -> RuntimeSnapshot {
    runtime.publish_control_change(app, None).await
}

fn normalize_address(address: String) -> Result<Option<String>, String> {
    let address = address.trim();
    if address.is_empty() {
        return Ok(None);
    }
    if address.chars().count() > MAX_ENDPOINT_CHARS {
        return Err(format!(
            "IPC address exceeds {MAX_ENDPOINT_CHARS} characters"
        ));
    }
    if address.contains('\0') {
        return Err("IPC address contains a null character".to_owned());
    }
    Ok(Some(address.to_owned()))
}

fn resolve_endpoint(config: &IpcConfig) -> String {
    let environment_override = env::var(ENV_IPC_PATH).ok();
    resolve_endpoint_with_override(config, environment_override.as_deref())
}

fn resolve_endpoint_with_override(
    config: &IpcConfig,
    environment_override: Option<&str>,
) -> String {
    environment_override
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| config.address.clone())
        .unwrap_or_else(default_endpoint)
}

fn default_endpoint() -> String {
    r"\\.\pipe\furry-companion-mcp".to_owned()
}

#[derive(Debug, PartialEq, Eq)]
enum NormalizedDecoded {
    Event(StateEvent),
    CoalescedValid,
    Diagnostic {
        pending_event: Option<StateEvent>,
        message: String,
    },
}

fn normalize_decoded_event(
    normalizer: &mut StateEventNormalizer,
    decoded: Result<StateEvent, DecodeError>,
    now: Instant,
) -> NormalizedDecoded {
    match decoded {
        Ok(event) => match normalizer.push(event, now) {
            Some(event) => NormalizedDecoded::Event(event),
            None => NormalizedDecoded::CoalescedValid,
        },
        Err(error) => NormalizedDecoded::Diagnostic {
            // Preserve wire order: an older, coalesced valid event must be
            // visible before this newer diagnostic.
            pending_event: normalizer.flush_pending(),
            message: short_error("Discarded IPC event", &error),
        },
    }
}

fn should_refresh_coalesced_status(last_emit_at_ms: u64, now_ms: u64) -> bool {
    last_emit_at_ms == 0 || now_ms.saturating_sub(last_emit_at_ms) >= COALESCED_STATUS_INTERVAL_MS
}

async fn supervise_connections(runtime: IpcRuntime, mut control: watch::Receiver<u64>) {
    let mut backoff = ReconnectBackoff::default();

    loop {
        let generation = runtime.generation();
        let config = runtime.config();
        let endpoint = resolve_endpoint(&config);

        if !config.enabled {
            runtime.publish_if_current(generation, ConnectionStatus::Disabled, &endpoint, None);
            backoff.reset();
            if control.changed().await.is_err() {
                return;
            }
            continue;
        }

        runtime.publish_if_current(generation, ConnectionStatus::Connecting, &endpoint, None);

        let stream = tokio::select! {
            biased;
            changed = control.changed() => {
                if changed.is_err() {
                    return;
                }
                backoff.reset();
                continue;
            }
            result = connect_endpoint(&endpoint) => result,
        };

        match stream {
            Ok(mut stream) => {
                runtime.publish_if_current(
                    generation,
                    ConnectionStatus::Connected,
                    &endpoint,
                    None,
                );

                let connected_at = Instant::now();
                let mut received_valid_event = false;
                let mut decoder = JsonLinesDecoder::default();
                let mut normalizer = StateEventNormalizer::default();
                let mut read_buffer = [0_u8; 8 * 1_024];
                let disconnect_reason = loop {
                    let flush_deadline = normalizer.deadline().unwrap_or_else(Instant::now);
                    let has_pending_event = normalizer.has_pending();

                    tokio::select! {
                        biased;
                        changed = control.changed() => {
                            if changed.is_err() {
                                return;
                            }
                            break None;
                        }
                        () = sleep_until(flush_deadline), if has_pending_event => {
                            if let Some(event) = normalizer.flush_due(Instant::now()) {
                                runtime.publish_agent_event(generation, &endpoint, event);
                            }
                        }
                        read = stream.read(&mut read_buffer) => {
                            match read {
                                Ok(0) => {
                                    if let Some(event) = normalizer.flush_pending() {
                                        runtime.publish_agent_event(
                                            generation, &endpoint, event,
                                        );
                                    }
                                    break Some("IPC peer closed the connection".to_owned());
                                }
                                Ok(count) => {
                                    for decoded in decoder.push(&read_buffer[..count]) {
                                        match normalize_decoded_event(
                                            &mut normalizer,
                                            decoded,
                                            Instant::now(),
                                        ) {
                                            NormalizedDecoded::Event(event) => {
                                                received_valid_event = true;
                                                runtime.publish_agent_event(
                                                    generation, &endpoint, event,
                                                );
                                            }
                                            NormalizedDecoded::CoalescedValid => {
                                                received_valid_event = true;
                                                runtime.record_coalesced_agent_event(
                                                    generation, &endpoint,
                                                );
                                            }
                                            NormalizedDecoded::Diagnostic {
                                                pending_event,
                                                message,
                                            } => {
                                                if let Some(event) = pending_event {
                                                    runtime.publish_agent_event(
                                                        generation, &endpoint, event,
                                                    );
                                                }
                                                runtime.publish_if_current(
                                                    generation,
                                                    ConnectionStatus::Connected,
                                                    &endpoint,
                                                    Some(message),
                                                );
                                            }
                                        }
                                    }
                                }
                                Err(error) => {
                                    if let Some(event) = normalizer.flush_pending() {
                                        runtime.publish_agent_event(
                                            generation, &endpoint, event,
                                        );
                                    }
                                    break Some(short_error("IPC read failed", &error));
                                }
                            }
                        }
                    }
                };

                if let Some(reason) = disconnect_reason {
                    if should_reset_backoff(received_valid_event, connected_at.elapsed()) {
                        backoff.reset();
                    }
                    runtime.publish_if_current(
                        generation,
                        ConnectionStatus::Disconnected,
                        &endpoint,
                        Some(reason),
                    );
                } else {
                    backoff.reset();
                    continue;
                }
            }
            Err(error) => {
                runtime.publish_if_current(
                    generation,
                    ConnectionStatus::Disconnected,
                    &endpoint,
                    Some(short_error("IPC connection failed", &error)),
                );
            }
        }

        tokio::select! {
            biased;
            changed = control.changed() => {
                if changed.is_err() {
                    return;
                }
                backoff.reset();
            }
            () = sleep(backoff.delay()) => {
                backoff.advance();
            }
        }
    }
}

fn short_error(context: &str, error: &dyn std::fmt::Display) -> String {
    const MAX_ERROR_CHARS: usize = 512;
    let value = format!("{context}: {error}");
    if value.chars().count() <= MAX_ERROR_CHARS {
        value
    } else {
        value.chars().take(MAX_ERROR_CHARS).collect()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

async fn connect_endpoint(endpoint: &str) -> io::Result<IpcStream> {
    use tokio::net::windows::named_pipe::ClientOptions;

    let stream = ClientOptions::new().open(endpoint)?;
    Ok(Box::pin(stream))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, thread};

    #[test]
    fn empty_address_means_platform_default() {
        assert_eq!(normalize_address(String::new()).unwrap(), None);
        let config = IpcConfig::default();

        // Test the Windows default separately so a developer environment
        // override cannot make this assertion flaky.
        assert_eq!(default_endpoint(), r"\\.\pipe\furry-companion-mcp");

        assert!(!config.enabled);
        assert!(config.address.is_none());
    }

    #[test]
    fn validates_custom_address() {
        assert_eq!(
            normalize_address("custom-endpoint".to_owned()).unwrap(),
            Some("custom-endpoint".to_owned())
        );
        assert!(normalize_address("\0invalid".to_owned()).is_err());
        assert!(normalize_address("x".repeat(MAX_ENDPOINT_CHARS + 1)).is_err());
    }

    #[test]
    fn environment_address_has_priority_over_configured_address() {
        let config = IpcConfig {
            address: Some("configured-endpoint".to_owned()),
            enabled: true,
        };

        assert_eq!(
            resolve_endpoint_with_override(&config, Some("environment-endpoint")),
            "environment-endpoint"
        );
        let default_config = IpcConfig::default();
        assert_eq!(
            resolve_endpoint_with_override(&default_config, Some("environment-endpoint")),
            "environment-endpoint"
        );
    }

    #[test]
    fn short_lived_connections_keep_exponential_backoff() {
        let mut backoff = ReconnectBackoff::default();
        let mut delays = Vec::new();

        for _ in 0..8 {
            delays.push(backoff.delay());
            backoff.advance();
        }

        assert_eq!(
            delays,
            vec![
                Duration::from_secs(1),
                Duration::from_secs(2),
                Duration::from_secs(4),
                Duration::from_secs(8),
                Duration::from_secs(16),
                Duration::from_secs(30),
                Duration::from_secs(30),
                Duration::from_secs(30),
            ]
        );
    }

    #[test]
    fn healthy_connection_resets_backoff() {
        let mut backoff = ReconnectBackoff::default();
        backoff.advance();
        backoff.advance();
        backoff.advance();
        assert_eq!(backoff.delay(), Duration::from_secs(8));

        backoff.reset();
        assert_eq!(backoff.delay(), INITIAL_BACKOFF);

        assert!(!should_reset_backoff(false, Duration::from_secs(29)));
        assert!(should_reset_backoff(true, Duration::ZERO));
        assert!(should_reset_backoff(false, STABLE_CONNECTION_RESET));
    }

    #[test]
    fn protocol_diagnostic_keeps_pending_valid_event_in_wire_order() {
        let start = Instant::now();
        let mut normalizer = StateEventNormalizer::default();
        let leading = state_event("leading");
        assert_eq!(
            normalize_decoded_event(&mut normalizer, Ok(leading.clone()), start),
            NormalizedDecoded::Event(leading)
        );

        let pending = state_event("pending before malformed input");
        assert_eq!(
            normalize_decoded_event(
                &mut normalizer,
                Ok(pending.clone()),
                start + Duration::from_millis(1),
            ),
            NormalizedDecoded::CoalescedValid
        );

        let diagnostic = normalize_decoded_event(
            &mut normalizer,
            Err(DecodeError::LineTooLong),
            start + Duration::from_millis(2),
        );
        assert_eq!(
            diagnostic,
            NormalizedDecoded::Diagnostic {
                pending_event: Some(pending),
                message: format!(
                    "Discarded IPC event: IPC line exceeds {} bytes",
                    crate::protocol::MAX_LINE_BYTES
                ),
            }
        );
        assert!(!normalizer.has_pending());
    }

    #[test]
    fn coalesced_status_refresh_is_bounded_to_once_per_second() {
        assert!(should_refresh_coalesced_status(0, 1));
        assert!(!should_refresh_coalesced_status(1_000, 1_999));
        assert!(should_refresh_coalesced_status(1_000, 2_000));
        assert!(!should_refresh_coalesced_status(2_000, 1_000));
    }

    #[test]
    fn retired_generation_cannot_enter_event_or_snapshot_commit() {
        let (runtime, _control) = IpcRuntime::new();
        let retired_generation = runtime.generation();
        let (current_generation, disabled_snapshot) = runtime.with_control_change(|_, state| {
            IpcRuntime::update_snapshot(
                state,
                ConnectionStatus::Disabled,
                "disabled-endpoint".to_owned(),
                None,
            )
        });

        let mut event_commit_count = 0;
        let event_result = runtime.with_current_generation(retired_generation, |_| {
            event_commit_count += 1;
        });
        let mut snapshot_commit_count = 0;
        let snapshot_result = runtime.with_current_generation(retired_generation, |state| {
            snapshot_commit_count += 1;
            IpcRuntime::update_snapshot(
                state,
                ConnectionStatus::Connected,
                "retired-endpoint".to_owned(),
                None,
            )
        });

        assert!(event_result.is_none());
        assert!(snapshot_result.is_none());
        assert_eq!(event_commit_count, 0);
        assert_eq!(snapshot_commit_count, 0);
        assert_ne!(retired_generation, current_generation);
        assert_eq!(runtime.snapshot(), disabled_snapshot);
    }

    #[test]
    fn delayed_old_publication_is_dropped_when_control_commits_first() {
        let (runtime, _control) = IpcRuntime::new();
        let reader_generation = runtime.generation();
        assert!(runtime.publish_agent_event(
            reader_generation,
            "retiring-reader",
            state_event("queued before disable"),
        ));
        let delayed_reader_publication = runtime.take_publication().unwrap();

        let (current_generation, disabled_snapshot) = runtime.with_control_change(|_, state| {
            let snapshot = IpcRuntime::update_snapshot(
                state,
                ConnectionStatus::Disabled,
                "disabled-endpoint".to_owned(),
                None,
            );
            runtime.enqueue_publication(state, None);
            snapshot
        });
        let control_publication = runtime.take_publication().unwrap();

        assert_eq!(delayed_reader_publication.generation, reader_generation);
        assert_eq!(control_publication.generation, current_generation);
        assert_ne!(reader_generation, current_generation);
        assert!(!runtime.claim_publication(&delayed_reader_publication));
        assert!(runtime.claim_publication(&control_publication));
        assert_eq!(runtime.snapshot(), disabled_snapshot);
        assert_eq!(disabled_snapshot.status, ConnectionStatus::Disabled);
        assert_eq!(disabled_snapshot.endpoint, "disabled-endpoint");

        let stale_overwrite = runtime.with_current_generation(reader_generation, |state| {
            IpcRuntime::update_snapshot(
                state,
                ConnectionStatus::Connected,
                "stale-reader".to_owned(),
                None,
            )
        });
        assert!(stale_overwrite.is_none());
        assert_eq!(runtime.generation(), current_generation);
        assert_eq!(runtime.snapshot(), disabled_snapshot);
    }

    #[test]
    fn new_generation_publications_are_queued_and_claimed_in_order() {
        let (runtime, _control) = IpcRuntime::new();
        let (generation, command_snapshot) = runtime.with_control_change(|_, state| {
            let snapshot = IpcRuntime::update_snapshot(
                state,
                ConnectionStatus::Connecting,
                "new-endpoint".to_owned(),
                None,
            );
            runtime.enqueue_publication(state, None);
            snapshot
        });
        let supervisor_snapshot = runtime
            .with_current_generation(generation, |state| {
                let snapshot = IpcRuntime::update_snapshot(
                    state,
                    ConnectionStatus::Connected,
                    "new-endpoint".to_owned(),
                    None,
                );
                runtime.enqueue_publication(state, None);
                snapshot
            })
            .unwrap();

        let command_publication = runtime.take_publication().unwrap();
        let supervisor_publication = runtime.take_publication().unwrap();
        assert_eq!(command_publication.snapshot, command_snapshot);
        assert_eq!(supervisor_publication.snapshot, supervisor_snapshot);
        assert_eq!(command_publication.generation, generation);
        assert_eq!(supervisor_publication.generation, generation);
        assert_eq!(command_publication.sequence, 1);
        assert_eq!(supervisor_publication.sequence, 2);

        assert!(!runtime.claim_publication(&supervisor_publication));
        assert!(runtime.claim_publication(&command_publication));
        assert!(runtime.claim_publication(&supervisor_publication));
    }

    #[test]
    fn bounded_queue_coalesces_its_tail_and_control_preempts_backlog() {
        let (runtime, _control) = IpcRuntime::new();
        let retired_generation = runtime.generation();
        let total_events = MAX_PENDING_PUBLICATIONS + 10;
        for index in 0..total_events {
            assert!(runtime.publish_agent_event(
                retired_generation,
                "busy-endpoint",
                state_event(&format!("event-{index}")),
            ));
        }

        {
            let committed = lock(&runtime.inner.commit);
            assert_eq!(committed.publications.len(), MAX_PENDING_PUBLICATIONS);
            assert_eq!(committed.publications.front().unwrap().sequence, 1);
            let tail = committed.publications.back().unwrap();
            assert_eq!(tail.sequence, MAX_PENDING_PUBLICATIONS as u64);
            assert_eq!(
                tail.agent_event
                    .as_ref()
                    .and_then(|event| event.message.as_deref()),
                Some(format!("event-{}", total_events - 1).as_str())
            );
        }

        let in_flight_retired = runtime.take_publication().unwrap();
        let (current_generation, disabled_snapshot) = runtime.with_control_change(|_, state| {
            let snapshot = IpcRuntime::update_snapshot(
                state,
                ConnectionStatus::Disabled,
                "disabled-endpoint".to_owned(),
                None,
            );
            runtime.enqueue_publication(state, None);
            snapshot
        });

        assert!(!runtime.claim_publication(&in_flight_retired));
        let control_publication = runtime.take_publication().unwrap();
        assert_eq!(control_publication.generation, current_generation);
        assert_eq!(control_publication.sequence, 1);
        assert_eq!(control_publication.snapshot, disabled_snapshot);
        assert!(runtime.take_publication().is_none());
        assert!(runtime.claim_publication(&control_publication));
    }

    #[test]
    fn supervisor_is_not_woken_until_command_snapshot_has_committed() {
        let (runtime, mut control) = IpcRuntime::new();
        let (command_entered_tx, command_entered_rx) = mpsc::channel();
        let (release_command_tx, release_command_rx) = mpsc::channel();
        let command_runtime = runtime.clone();

        let command = thread::spawn(move || {
            command_runtime.with_control_change(|generation, state| {
                let snapshot = IpcRuntime::update_snapshot(
                    state,
                    ConnectionStatus::Connecting,
                    "new-endpoint".to_owned(),
                    None,
                );
                command_entered_tx
                    .send((generation, snapshot.clone()))
                    .unwrap();
                release_command_rx.recv().unwrap();
                snapshot
            })
        });

        let (expected_generation, expected_command_snapshot) = command_entered_rx.recv().unwrap();
        assert!(!control.has_changed().unwrap());
        release_command_tx.send(()).unwrap();
        let (command_generation, command_snapshot) = command.join().unwrap();

        assert_eq!(command_generation, expected_generation);
        assert_eq!(command_snapshot, expected_command_snapshot);
        assert!(control.has_changed().unwrap());
        let supervisor_generation = *control.borrow_and_update();
        assert_eq!(supervisor_generation, command_generation);
        assert_eq!(runtime.snapshot(), command_snapshot);

        let supervisor_snapshot = runtime
            .with_current_generation(supervisor_generation, |state| {
                IpcRuntime::update_snapshot(
                    state,
                    ConnectionStatus::Connected,
                    "new-endpoint".to_owned(),
                    None,
                )
            })
            .expect("the supervisor must commit against the command generation");
        assert_eq!(supervisor_snapshot.revision, command_snapshot.revision + 1);
        assert_eq!(supervisor_snapshot.status, ConnectionStatus::Connected);
        assert_eq!(runtime.snapshot(), supervisor_snapshot);
    }

    fn state_event(message: &str) -> StateEvent {
        StateEvent {
            event_type: "state",
            state: crate::protocol::AgentState::Coding,
            session_title: None,
            message: Some(message.to_owned()),
            file: None,
        }
    }
}
