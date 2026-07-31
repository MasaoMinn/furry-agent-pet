use std::time::Duration;

use tokio::time::Instant;

use crate::protocol::{AgentState, StateEvent};

pub const REPEATED_STATE_WINDOW: Duration = Duration::from_millis(50);

/// Applies a small leading-and-trailing window to repeated non-terminal
/// states. State transitions and terminal states remain immediate, while a
/// burst of updates for one state emits only its latest complete payload.
///
/// Events are never merged field-by-field: if the latest event omits `file`,
/// `message`, or `session_title`, the omission clears the previous detail.
#[derive(Default)]
pub struct StateEventNormalizer {
    last_emitted: Option<StateEvent>,
    pending: Option<StateEvent>,
    pending_deadline: Option<Instant>,
}

impl StateEventNormalizer {
    pub fn push(&mut self, event: StateEvent, now: Instant) -> Option<StateEvent> {
        let Some(last_emitted) = self.last_emitted.as_ref() else {
            return self.emit(event);
        };

        let state_changed = event.state != last_emitted.state;
        let session_changed = event.session_title != last_emitted.session_title;
        let terminal = matches!(event.state, AgentState::Success | AgentState::Error);
        if state_changed || session_changed || terminal {
            self.clear_pending();
            if self.last_emitted.as_ref() == Some(&event) {
                return None;
            }
            return self.emit(event);
        }

        // An exact heartbeat needs no UI update unless it supersedes a
        // different pending payload inside the current coalescing window.
        if self.pending.is_none() && self.last_emitted.as_ref() == Some(&event) {
            return None;
        }

        self.pending = Some(event);
        self.pending_deadline
            .get_or_insert(now + REPEATED_STATE_WINDOW);
        None
    }

    pub fn deadline(&self) -> Option<Instant> {
        self.pending_deadline
    }

    pub fn has_pending(&self) -> bool {
        self.pending.is_some()
    }

    pub fn flush_due(&mut self, now: Instant) -> Option<StateEvent> {
        if self
            .pending_deadline
            .is_some_and(|deadline| now >= deadline)
        {
            self.flush_pending()
        } else {
            None
        }
    }

    pub fn flush_pending(&mut self) -> Option<StateEvent> {
        self.pending_deadline = None;
        let event = self.pending.take()?;
        if self.last_emitted.as_ref() == Some(&event) {
            return None;
        }
        self.emit(event)
    }

    fn emit(&mut self, event: StateEvent) -> Option<StateEvent> {
        self.last_emitted = Some(event.clone());
        Some(event)
    }

    fn clear_pending(&mut self) {
        self.pending = None;
        self.pending_deadline = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn burst_emits_the_leading_and_latest_complete_event() {
        let start = Instant::now();
        let mut normalizer = StateEventNormalizer::default();
        let leading = event(AgentState::Coding, Some("0"), Some("src/0.ts"));
        assert_eq!(normalizer.push(leading.clone(), start), Some(leading));

        for index in 1..=1_000 {
            assert_eq!(
                normalizer.push(
                    event(
                        AgentState::Coding,
                        Some(&index.to_string()),
                        Some(&format!("src/{index}.ts")),
                    ),
                    start + Duration::from_millis(1),
                ),
                None
            );
        }

        assert!(normalizer.has_pending());
        assert_eq!(
            normalizer.flush_due(start + Duration::from_millis(49)),
            None
        );
        assert_eq!(
            normalizer.flush_due(start + Duration::from_millis(1) + REPEATED_STATE_WINDOW),
            Some(event(AgentState::Coding, Some("1000"), Some("src/1000.ts")))
        );
        assert!(!normalizer.has_pending());
    }

    #[test]
    fn a_state_transition_drops_stale_pending_details() {
        let start = Instant::now();
        let mut normalizer = StateEventNormalizer::default();
        normalizer.push(event(AgentState::Thinking, Some("first"), None), start);
        normalizer.push(
            event(AgentState::Thinking, Some("stale"), None),
            start + Duration::from_millis(1),
        );

        let coding = event(AgentState::Coding, Some("current"), Some("src/main.ts"));
        assert_eq!(
            normalizer.push(coding.clone(), start + Duration::from_millis(2)),
            Some(coding)
        );
        assert_eq!(normalizer.flush_pending(), None);
    }

    #[test]
    fn terminal_states_are_immediate_and_exact_duplicates_are_dropped() {
        let start = Instant::now();
        let mut normalizer = StateEventNormalizer::default();
        normalizer.push(event(AgentState::Coding, Some("working"), None), start);
        normalizer.push(
            event(AgentState::Coding, Some("pending"), None),
            start + Duration::from_millis(1),
        );

        let success = event(AgentState::Success, Some("done"), None);
        assert_eq!(
            normalizer.push(success.clone(), start + Duration::from_millis(2)),
            Some(success.clone())
        );
        assert_eq!(
            normalizer.push(success, start + Duration::from_millis(3)),
            None
        );

        let updated_success = event(AgentState::Success, Some("done with details"), None);
        assert_eq!(
            normalizer.push(updated_success.clone(), start + Duration::from_millis(4)),
            Some(updated_success)
        );
        let error = event(AgentState::Error, Some("blocked"), None);
        assert_eq!(
            normalizer.push(error.clone(), start + Duration::from_millis(5)),
            Some(error)
        );
    }

    #[test]
    fn session_title_changes_are_immediate_even_for_the_same_state() {
        let start = Instant::now();
        let mut normalizer = StateEventNormalizer::default();
        let session_a = event_with_session(
            AgentState::Coding,
            Some("会话 A"),
            Some("working"),
            Some("src/a.ts"),
        );
        assert_eq!(normalizer.push(session_a.clone(), start), Some(session_a));

        let session_b = event_with_session(
            AgentState::Coding,
            Some("会话 B"),
            Some("working"),
            Some("src/b.ts"),
        );
        assert_eq!(
            normalizer.push(session_b.clone(), start + Duration::from_millis(1)),
            Some(session_b)
        );
        assert!(!normalizer.has_pending());
    }

    #[test]
    fn the_latest_whole_event_can_clear_message_and_file() {
        let start = Instant::now();
        let mut normalizer = StateEventNormalizer::default();
        normalizer.push(
            event(AgentState::Testing, Some("running"), Some("secret.ts")),
            start,
        );
        normalizer.push(
            event(AgentState::Testing, None, None),
            start + Duration::from_millis(1),
        );

        assert_eq!(
            normalizer.flush_pending(),
            Some(event(AgentState::Testing, None, None))
        );
    }

    fn event(state: AgentState, message: Option<&str>, file: Option<&str>) -> StateEvent {
        event_with_session(state, None, message, file)
    }

    fn event_with_session(
        state: AgentState,
        session_title: Option<&str>,
        message: Option<&str>,
        file: Option<&str>,
    ) -> StateEvent {
        StateEvent {
            event_type: "state",
            state,
            session_title: session_title.map(str::to_owned),
            message: message.map(str::to_owned),
            file: file.map(str::to_owned),
        }
    }
}
