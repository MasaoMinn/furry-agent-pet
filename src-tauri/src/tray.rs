use tauri::{
    menu::{CheckMenuItem, MenuBuilder, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

use crate::{ipc, settings as app_settings, window_recovery};

const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "furry-agent-pet-tray";

const CONNECTION_STATUS_ID: &str = "connection-status";
const SHOW_HIDE_ID: &str = "show-hide";
const RESTORE_POSITION_ID: &str = "restore-position";
const ALWAYS_ON_TOP_ID: &str = "always-on-top";
const SETTINGS_ID: &str = "settings";
const RECONNECT_ID: &str = "reconnect";
const QUIT_ID: &str = "quit";
const ALWAYS_ON_TOP_CHANGED_EVENT: &str = "always-on-top-changed";

struct TrayState {
    always_on_top: CheckMenuItem<tauri::Wry>,
    connection_status: MenuItem<tauri::Wry>,
}

/// Installs the desktop pet's system tray icon and its platform-neutral controls.
pub fn setup(app: &tauri::AppHandle) -> tauri::Result<()> {
    let initial_status = ipc::ConnectionStatus::Disabled;
    let connection_status = MenuItem::with_id(
        app,
        CONNECTION_STATUS_ID,
        connection_status_menu_text(initial_status),
        false,
        None::<&str>,
    )?;
    let show_hide = MenuItem::with_id(app, SHOW_HIDE_ID, "显示/隐藏桌宠", true, None::<&str>)?;
    let restore_position =
        MenuItem::with_id(app, RESTORE_POSITION_ID, "恢复默认位置", true, None::<&str>)?;

    let initially_always_on_top = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .and_then(|window| window.is_always_on_top().ok())
        .unwrap_or(true);
    let always_on_top = CheckMenuItem::with_id(
        app,
        ALWAYS_ON_TOP_ID,
        "总在最前",
        true,
        initially_always_on_top,
        None::<&str>,
    )?;

    let settings = MenuItem::with_id(app, SETTINGS_ID, "设置", true, None::<&str>)?;
    let reconnect = MenuItem::with_id(app, RECONNECT_ID, "重新连接", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "退出", true, None::<&str>)?;

    let menu = MenuBuilder::new(app)
        .item(&connection_status)
        .separator()
        .item(&show_hide)
        .item(&restore_position)
        .item(&always_on_top)
        .separator()
        .item(&settings)
        .item(&reconnect)
        .separator()
        .item(&quit)
        .build()?;

    let always_on_top_for_menu = always_on_top.clone();
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip(connection_status_tooltip(initial_status))
        .on_menu_event(move |app, event| match event.id().as_ref() {
            SHOW_HIDE_ID => toggle_main_window(app),
            RESTORE_POSITION_ID => restore_default_position(app),
            ALWAYS_ON_TOP_ID => toggle_always_on_top(app, &always_on_top_for_menu),
            SETTINGS_ID => {
                show_main_window(app);
                let _ = app.emit("open-settings", ());
            }
            RECONNECT_ID => ipc::request_reconnect(app),
            QUIT_ID => request_exit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        });

    // Linux tray backends do not provide reliable click events. Keep their
    // default left-click menu so the controls remain reachable.
    #[cfg(not(target_os = "linux"))]
    {
        tray = tray.show_menu_on_left_click(false);
    }

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    app.manage(TrayState {
        always_on_top,
        connection_status,
    });
    Ok(())
}

pub fn update_connection_status(app: &AppHandle, status: ipc::ConnectionStatus) {
    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state
            .connection_status
            .set_text(connection_status_menu_text(status));
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(connection_status_tooltip(status)));
    }
}

fn connection_status_label(status: ipc::ConnectionStatus) -> &'static str {
    match status {
        ipc::ConnectionStatus::Connecting => "正在连接",
        ipc::ConnectionStatus::Connected => "已连接",
        ipc::ConnectionStatus::Disconnected => "未连接",
        ipc::ConnectionStatus::Disabled => "已停用",
    }
}

fn connection_status_menu_text(status: ipc::ConnectionStatus) -> String {
    format!("连接状态：{}", connection_status_label(status))
}

fn connection_status_tooltip(status: ipc::ConnectionStatus) -> String {
    format!("furry-agent-pet — {}", connection_status_menu_text(status))
}

#[tauri::command]
pub fn set_always_on_top(app: AppHandle, always_on_top: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Main window is unavailable".to_owned())?;
    window
        .set_always_on_top(always_on_top)
        .map_err(|error| error.to_string())?;

    if let Some(state) = app.try_state::<TrayState>() {
        let _ = state.always_on_top.set_checked(always_on_top);
    }
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    request_exit(&app);
}

pub fn request_exit<R: Runtime>(app: &AppHandle<R>) {
    app.exit(0);
}

fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    match window.is_visible() {
        Ok(true) => {
            let _ = window.hide();
        }
        Ok(false) | Err(_) => {
            let _ = window_recovery::recover_if_offscreen(&window);
            let _ = window.show();
        }
    }
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window_recovery::recover_if_offscreen(&window);
        let _ = window.show();
        // Opening settings is an explicit user action, unlike normal desktop
        // pet startup, so keyboard focus is appropriate and expected here.
        let _ = window.set_focus();
    }
}

fn restore_default_position<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.center();
        let _ = window_recovery::recover_if_offscreen(&window);
        let _ = window.show();
    }
}

fn toggle_always_on_top<R: Runtime>(app: &AppHandle<R>, item: &CheckMenuItem<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    let current = window
        .is_always_on_top()
        .or_else(|_| item.is_checked())
        .unwrap_or(true);
    let next = !current;

    if window.set_always_on_top(next).is_ok()
        && app_settings::set_persisted_always_on_top(app, next).is_ok()
    {
        let _ = item.set_checked(next);
        let _ = app.emit(ALWAYS_ON_TOP_CHANGED_EVENT, next);
    } else {
        // Native check items may toggle before this handler runs. If either
        // the window or Rust-owned Store update fails, restore both sources of
        // truth and do not tell the frontend that the change succeeded.
        let _ = window.set_always_on_top(current);
        let _ = item.set_checked(current);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_status_copy_covers_every_runtime_state() {
        let cases = [
            (ipc::ConnectionStatus::Connecting, "正在连接"),
            (ipc::ConnectionStatus::Connected, "已连接"),
            (ipc::ConnectionStatus::Disconnected, "未连接"),
            (ipc::ConnectionStatus::Disabled, "已停用"),
        ];

        for (status, expected) in cases {
            assert_eq!(connection_status_label(status), expected);
            assert_eq!(
                connection_status_menu_text(status),
                format!("连接状态：{expected}")
            );
            assert_eq!(
                connection_status_tooltip(status),
                format!("furry-agent-pet — 连接状态：{expected}")
            );
        }
    }
}
