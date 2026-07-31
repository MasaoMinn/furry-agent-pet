mod ipc;
mod pet_packages;
mod pointer_gesture;
#[cfg(windows)]
mod pointer_regions;
mod protocol;
mod settings;
mod state_normalizer;
mod tray;
mod window_recovery;
mod window_visibility;

use tauri::{Manager, WindowEvent};
use tauri_plugin_window_state::StateFlags;

struct TrayAvailability(bool);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CloseBehavior {
    Hide,
    Exit,
}

fn close_behavior(tray_available: bool) -> CloseBehavior {
    if tray_available {
        CloseBehavior::Hide
    } else {
        CloseBehavior::Exit
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(Default::default(), None))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window_recovery::recover_if_offscreen(&window);
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                // Scale is persisted by the app settings and deterministically
                // derives the logical window size. Restoring a second saved
                // size can race the frontend and crop a scaled pet.
                .with_state_flags(StateFlags::POSITION | StateFlags::VISIBLE)
                // Visibility restoration is performed without focusing the
                // pet after tray availability is known in application setup.
                .skip_initial_state("main")
                .with_filename(window_visibility::WINDOW_STATE_FILENAME)
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            ipc::install(app);
            if let Some(window) = app.get_webview_window("main") {
                pointer_regions::install(&window).map_err(std::io::Error::other)?;
            }
            let tray_available = match tray::setup(app.handle()) {
                Ok(()) => true,
                Err(error) => {
                    eprintln!("System tray is unavailable; continuing without it: {error}");
                    false
                }
            };
            app.manage(TrayAvailability(tray_available));
            if let Err(error) = window_visibility::restore_initial(app.handle(), tray_available) {
                eprintln!("Could not restore the initial window state: {error}");
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window_recovery::recover_if_offscreen(&window);
                    let _ = window.show();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::get_runtime_snapshot,
            ipc::set_ipc_config,
            ipc::reconnect_ipc,
            pet_packages::list_imported_pet_packages,
            pet_packages::import_pet_package,
            pet_packages::remove_imported_pet_package,
            pointer_gesture::start_tracked_window_drag,
            pointer_regions::set_pointer_capture_regions,
            settings::load_app_settings,
            settings::save_app_settings,
            settings::reset_app_settings,
            tray::set_always_on_top,
            tray::quit_app
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if matches!(event, WindowEvent::Moved(_)) {
                    let _ = window_recovery::constrain_native_window_to_work_areas(window);
                } else if matches!(
                    event,
                    WindowEvent::Resized(_)
                        | WindowEvent::ScaleFactorChanged { .. }
                        | WindowEvent::Focused(true)
                ) {
                    let _ = window_recovery::recover_native_window_if_offscreen(window);
                }
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    match close_behavior(window.state::<TrayAvailability>().0) {
                        CloseBehavior::Hide => {
                            let _ = window.hide();
                        }
                        CloseBehavior::Exit => tray::request_exit(window.app_handle()),
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closing_without_a_reachable_tray_exits() {
        assert_eq!(close_behavior(false), CloseBehavior::Exit);
    }

    #[test]
    fn closing_with_a_reachable_tray_hides_the_window() {
        assert_eq!(close_behavior(true), CloseBehavior::Hide);
    }
}
