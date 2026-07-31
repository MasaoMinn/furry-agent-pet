use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{PhysicalPosition, Runtime, Window};
use windows_sys::Win32::Foundation::POINT;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

const POLL_INTERVAL: Duration = Duration::from_millis(8);
const MAX_RELEASE_WAIT_MS: u64 = 1_000;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointerGestureResult {
    released_within_timeout: bool,
    delta_x: i32,
    delta_y: i32,
}

#[tauri::command]
pub async fn start_tracked_window_drag<R: Runtime>(
    window: Window<R>,
    timeout_ms: u64,
) -> Result<PointerGestureResult, String> {
    if timeout_ms == 0 || timeout_ms > MAX_RELEASE_WAIT_MS {
        return Err(format!(
            "Pointer release timeout must be between 1 and {MAX_RELEASE_WAIT_MS} ms"
        ));
    }

    let start = cursor_position()?;
    let window_start = window
        .outer_position()
        .map_err(|error| format!("Could not read the window position: {error}"))?;
    crate::pointer_regions::set_suspended(true);
    let drag_result = tauri::async_runtime::spawn_blocking(move || {
        let started_at = Instant::now();
        let release_deadline = started_at + Duration::from_millis(MAX_RELEASE_WAIT_MS);
        let mut last_delta = (0, 0);
        loop {
            // GetAsyncKeyState is process-local observation of the current
            // Windows input state and does not install a global hook.
            let state = unsafe { GetAsyncKeyState(i32::from(VK_LBUTTON)) };
            let current = cursor_position()?;
            let delta = (current.x - start.x, current.y - start.y);
            if delta != last_delta {
                window
                    .set_position(PhysicalPosition::new(
                        window_start.x.saturating_add(delta.0),
                        window_start.y.saturating_add(delta.1),
                    ))
                    .map_err(|error| format!("Could not move the window: {error}"))?;
                last_delta = delta;
            }
            if !button_is_down(state) {
                return Ok::<_, String>((
                    started_at.elapsed() <= Duration::from_millis(timeout_ms),
                    delta,
                ));
            }
            if Instant::now() >= release_deadline {
                return Ok((false, delta));
            }
            std::thread::sleep(POLL_INTERVAL);
        }
    })
    .await
    .map_err(|error| format!("Could not observe pointer release: {error}"));
    crate::pointer_regions::set_suspended(false);
    let (released_within_timeout, delta) = drag_result??;
    Ok(PointerGestureResult {
        released_within_timeout,
        delta_x: delta.0,
        delta_y: delta.1,
    })
}

fn cursor_position() -> Result<POINT, String> {
    let mut point = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut point) } == 0 {
        return Err("Could not read the Windows pointer position".to_owned());
    }
    Ok(point)
}

fn button_is_down(state: i16) -> bool {
    state < 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_high_order_button_state_bit() {
        assert!(button_is_down(i16::MIN));
        assert!(!button_is_down(0));
        assert!(!button_is_down(1));
    }
}
