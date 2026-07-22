use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

const STORE_PATH: &str = "settings.json";
const STORE_KEY: &str = "settings";
const DEFAULT_PET_PACKAGE_ID: &str = "furry-ai-state";
const AGENT_STATES: [&str; 7] = [
    "idle", "thinking", "planning", "coding", "testing", "success", "error",
];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    scale: f64,
    opacity: f64,
    always_on_top: bool,
    show_state_bubble: bool,
    show_file_path: bool,
    success_bubble_duration_ms: u64,
    pet_package_id: String,
    state_animation_overrides: BTreeMap<String, String>,
    onboarding_version: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            scale: 1.0,
            opacity: 1.0,
            always_on_top: true,
            show_state_bubble: true,
            show_file_path: false,
            success_bubble_duration_ms: 15_000,
            pet_package_id: DEFAULT_PET_PACKAGE_ID.to_owned(),
            state_animation_overrides: BTreeMap::new(),
            onboarding_version: 0,
        }
    }
}

impl AppSettings {
    fn normalize(value: Option<&Value>) -> Self {
        let defaults = Self::default();
        let object = value.and_then(Value::as_object);

        Self {
            scale: bounded_number(object, "scale", 0.5, 2.0, defaults.scale),
            opacity: bounded_number(object, "opacity", 0.3, 1.0, defaults.opacity),
            always_on_top: boolean(object, "alwaysOnTop", defaults.always_on_top),
            show_state_bubble: boolean(object, "showStateBubble", defaults.show_state_bubble),
            show_file_path: boolean(object, "showFilePath", defaults.show_file_path),
            success_bubble_duration_ms: bounded_integer(
                object,
                "successBubbleDurationMs",
                3_000,
                60_000,
                defaults.success_bubble_duration_ms,
            ),
            pet_package_id: package_id(object).unwrap_or(defaults.pet_package_id),
            state_animation_overrides: state_animation_overrides(object),
            onboarding_version: non_negative_u32(object, "onboardingVersion")
                .unwrap_or(defaults.onboarding_version),
        }
    }
}

#[tauri::command]
pub fn load_app_settings(app: AppHandle) -> Result<AppSettings, String> {
    let store = app.store(STORE_PATH).map_err(|error| error.to_string())?;
    let stored = store.get(STORE_KEY);
    let settings = AppSettings::normalize(stored.as_ref());
    let normalized = serde_json::to_value(&settings).map_err(|error| error.to_string())?;

    if stored.as_ref() != Some(&normalized) {
        store.set(STORE_KEY, normalized);
        store.save().map_err(|error| error.to_string())?;
    }

    Ok(settings)
}

#[tauri::command]
pub fn save_app_settings(app: AppHandle, settings: Value) -> Result<AppSettings, String> {
    let settings = AppSettings::normalize(Some(&settings));
    persist(&app, &settings)?;
    Ok(settings)
}

#[tauri::command]
pub fn reset_app_settings(app: AppHandle, onboarding_version: u32) -> Result<AppSettings, String> {
    let settings = AppSettings {
        onboarding_version,
        ..AppSettings::default()
    };
    persist(&app, &settings)?;
    Ok(settings)
}

pub fn set_persisted_always_on_top<R: Runtime>(
    app: &AppHandle<R>,
    always_on_top: bool,
) -> Result<(), String> {
    let store = app.store(STORE_PATH).map_err(|error| error.to_string())?;
    let stored = store.get(STORE_KEY);
    let mut settings = AppSettings::normalize(stored.as_ref());
    settings.always_on_top = always_on_top;
    let value = serde_json::to_value(settings).map_err(|error| error.to_string())?;
    store.set(STORE_KEY, value);
    Ok(())
}

fn persist(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let store = app.store(STORE_PATH).map_err(|error| error.to_string())?;
    let value = serde_json::to_value(settings).map_err(|error| error.to_string())?;
    store.set(STORE_KEY, value);
    // Store owns the 100 ms autosave debounce and flushes pending writes on
    // application exit. Avoid forcing synchronous disk I/O for every slider
    // input event.
    Ok(())
}

fn bounded_number(
    object: Option<&Map<String, Value>>,
    key: &str,
    min: f64,
    max: f64,
    fallback: f64,
) -> f64 {
    object
        .and_then(|object| object.get(key))
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite())
        .map(|value| value.clamp(min, max))
        .unwrap_or(fallback)
}

fn bounded_integer(
    object: Option<&Map<String, Value>>,
    key: &str,
    min: u64,
    max: u64,
    fallback: u64,
) -> u64 {
    object
        .and_then(|object| object.get(key))
        .and_then(Value::as_u64)
        .map(|value| value.clamp(min, max))
        .unwrap_or(fallback)
}

fn boolean(object: Option<&Map<String, Value>>, key: &str, fallback: bool) -> bool {
    object
        .and_then(|object| object.get(key))
        .and_then(Value::as_bool)
        .unwrap_or(fallback)
}

fn package_id(object: Option<&Map<String, Value>>) -> Option<String> {
    let value = bounded_trimmed_string(object, "petPackageId", 80)?;
    valid_identifier(&value).then_some(value)
}

fn state_animation_overrides(object: Option<&Map<String, Value>>) -> BTreeMap<String, String> {
    let Some(overrides) = object
        .and_then(|object| object.get("stateAnimationOverrides"))
        .and_then(Value::as_object)
    else {
        return BTreeMap::new();
    };

    AGENT_STATES
        .into_iter()
        .filter_map(|state| {
            let animation = overrides.get(state)?.as_str()?.trim();
            (animation.chars().count() <= 64 && valid_identifier(animation))
                .then(|| (state.to_owned(), animation.to_owned()))
        })
        .collect()
}

fn bounded_trimmed_string(
    object: Option<&Map<String, Value>>,
    key: &str,
    max_chars: usize,
) -> Option<String> {
    let value = object?.get(key)?.as_str()?.trim();
    (value.chars().count() <= max_chars).then(|| value.to_owned())
}

fn non_negative_u32(object: Option<&Map<String, Value>>, key: &str) -> Option<u32> {
    let value = object?.get(key)?.as_u64()?;
    u32::try_from(value).ok()
}

fn valid_identifier(value: &str) -> bool {
    let mut characters = value.chars();
    characters
        .next()
        .is_some_and(|character| character.is_ascii_alphanumeric())
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn normalizes_corrupt_or_partial_values_field_by_field() {
        let settings = AppSettings::normalize(Some(&json!({
            "scale": 9,
            "opacity": 0,
            "alwaysOnTop": "yes",
            "showFilePath": true,
            "successBubbleDurationMs": 90_000,
            "ipcAddress": "retired.sock",
            "ipcEnabled": false,
            "reduceMotion": true,
            "onboardingVersion": -1
        })));

        assert_eq!(settings.scale, 2.0);
        assert_eq!(settings.opacity, 0.3);
        assert!(settings.always_on_top);
        assert!(settings.show_file_path);
        assert_eq!(settings.success_bubble_duration_ms, 60_000);
        assert_eq!(settings.onboarding_version, 0);
    }

    #[test]
    fn rejects_fractional_duration() {
        let settings = AppSettings::normalize(Some(&json!({
            "successBubbleDurationMs": 3_500.5
        })));

        assert_eq!(settings.success_bubble_duration_ms, 15_000);
    }

    #[test]
    fn keeps_only_known_states_and_safe_animation_ids() {
        let settings = AppSettings::normalize(Some(&json!({
            "petPackageId": "local-0123456789abcdef01234567",
            "stateAnimationOverrides": {
                "thinking": "  coding  ",
                "error": "../outside",
                "unknown": "sleeping"
            }
        })));

        assert_eq!(settings.pet_package_id, "local-0123456789abcdef01234567");
        assert_eq!(
            settings.state_animation_overrides,
            BTreeMap::from([("thinking".to_owned(), "coding".to_owned())])
        );
    }

    #[test]
    fn serializes_the_existing_frontend_store_shape() {
        let value = serde_json::to_value(AppSettings::default()).expect("serialize defaults");
        let object = value.as_object().expect("settings object");

        assert_eq!(object.len(), 9);
        assert_eq!(object.get("petPackageId"), Some(&json!("furry-ai-state")));
        assert!(!object.contains_key("reduceMotion"));
        assert!(!object.contains_key("ipcAddress"));
        assert!(!object.contains_key("ipcEnabled"));
        assert_eq!(object.get("successBubbleDurationMs"), Some(&json!(15_000)));
        assert_eq!(object.get("stateAnimationOverrides"), Some(&json!({})));
    }
}
