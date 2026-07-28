use std::fs;

use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_window_state::{StateFlags, WindowExt};

use crate::window_recovery;

pub const WINDOW_STATE_FILENAME: &str = ".window-state.json";
const MAIN_WINDOW_LABEL: &str = "main";

/// Restores position and visibility without letting the window-state plugin
/// focus the pet during ordinary startup.
///
/// The window starts hidden in `tauri.conf.json`. A saved `visible: true`
/// state (or the absence of a prior state) shows it after its position has
/// been validated. If the tray could not be created, the window is always
/// shown so the application cannot become unreachable.
pub fn restore_initial<R: Runtime>(
    app: &AppHandle<R>,
    tray_available: bool,
) -> tauri::Result<bool> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(false);
    };

    let should_show = should_show_initial(tray_available, saved_main_visibility(app));

    // Restore only the position here. Including VISIBLE would make the plugin
    // focus a visible pet, which conflicts with the no-focus startup contract.
    window.restore_state(StateFlags::POSITION)?;

    if should_show {
        window_recovery::recover_if_offscreen(&window)?;
        window.show()?;
    } else {
        // Some WebView/runtime combinations can make the configured window
        // visible before application setup finishes. Enforce the persisted
        // hidden state instead of relying only on `visible: false` in config.
        window.hide()?;
    }

    Ok(should_show)
}

fn should_show_initial(tray_available: bool, saved_visibility: Option<bool>) -> bool {
    !tray_available || saved_visibility.unwrap_or(true)
}

fn saved_main_visibility<R: Runtime>(app: &AppHandle<R>) -> Option<bool> {
    let path = app
        .path()
        .app_config_dir()
        .ok()?
        .join(WINDOW_STATE_FILENAME);
    let bytes = fs::read(path).ok()?;
    parse_main_visibility(&bytes)
}

fn parse_main_visibility(bytes: &[u8]) -> Option<bool> {
    let value: Value = serde_json::from_slice(bytes).ok()?;
    value.get(MAIN_WINDOW_LABEL)?.get("visible")?.as_bool()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_saved_main_window_visibility() {
        assert_eq!(
            parse_main_visibility(br#"{"main":{"visible":false,"x":42}}"#),
            Some(false)
        );
        assert_eq!(
            parse_main_visibility(br#"{"main":{"visible":true}}"#),
            Some(true)
        );
    }

    #[test]
    fn missing_or_corrupt_visibility_uses_first_run_fallback() {
        assert_eq!(parse_main_visibility(br#"{"main":{"x":42}}"#), None);
        assert_eq!(
            parse_main_visibility(br#"{"other":{"visible":false}}"#),
            None
        );
        assert_eq!(parse_main_visibility(b"not json"), None);
    }

    #[test]
    fn startup_visibility_keeps_the_app_reachable() {
        assert!(should_show_initial(false, Some(false)));
        assert!(should_show_initial(true, Some(true)));
        assert!(should_show_initial(true, None));

        assert!(!should_show_initial(true, Some(false)));
    }
}
