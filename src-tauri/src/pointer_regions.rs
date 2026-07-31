use std::sync::{
    atomic::{AtomicBool, Ordering},
    OnceLock, RwLock,
};

use serde::Deserialize;
use tauri::{Emitter, Manager, WebviewWindow};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    UI::Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TRACKMOUSEEVENT},
    UI::WindowsAndMessaging::{
        CallWindowProcW, GetWindowRect, SetWindowLongPtrW, GWLP_WNDPROC, HTCLIENT, HTTRANSPARENT,
        WM_MOUSEMOVE, WM_NCHITTEST, WNDPROC,
    },
};

const MAX_POINTER_REGIONS: usize = 256;
const WM_MOUSELEAVE: u32 = 0x02A3;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PointerRegion {
    left: i32,
    top: i32,
    width: u32,
    height: u32,
}

impl PointerRegion {
    fn contains(self, x: i32, y: i32) -> bool {
        let right = i64::from(self.left) + i64::from(self.width);
        let bottom = i64::from(self.top) + i64::from(self.height);
        i64::from(x) >= i64::from(self.left)
            && i64::from(x) < right
            && i64::from(y) >= i64::from(self.top)
            && i64::from(y) < bottom
    }

    fn valid(self) -> bool {
        self.width > 0 && self.height > 0
    }
}

#[derive(Default)]
struct PointerRegionState {
    initialized: bool,
    regions: Vec<PointerRegion>,
}

static STATE: OnceLock<RwLock<PointerRegionState>> = OnceLock::new();
static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
static POINTER_INSIDE: AtomicBool = AtomicBool::new(false);
static SUSPENDED: AtomicBool = AtomicBool::new(false);
static ORIGINAL_WINDOW_PROC: std::sync::atomic::AtomicIsize =
    std::sync::atomic::AtomicIsize::new(0);

pub fn set_suspended(suspended: bool) {
    SUSPENDED.store(suspended, Ordering::Release);
}

fn notify_pointer_left() {
    if POINTER_INSIDE.swap(false, Ordering::AcqRel) {
        if let Some(app_handle) = APP_HANDLE.get() {
            let _ = app_handle.emit("pointer-capture-left", ());
        }
    }
}

pub fn install(window: &WebviewWindow) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as HWND;
    STATE.get_or_init(|| RwLock::new(PointerRegionState::default()));
    let _ = APP_HANDLE.set(window.app_handle().clone());
    if ORIGINAL_WINDOW_PROC.load(Ordering::Acquire) != 0 {
        return Ok(());
    }

    let original = unsafe {
        SetWindowLongPtrW(
            hwnd,
            GWLP_WNDPROC,
            pointer_region_window_proc as *const () as isize,
        )
    };
    if original == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    ORIGINAL_WINDOW_PROC.store(original, Ordering::Release);
    Ok(())
}

#[tauri::command]
pub fn set_pointer_capture_regions(regions: Vec<PointerRegion>) -> Result<(), String> {
    if regions.is_empty()
        || regions.len() > MAX_POINTER_REGIONS
        || regions.iter().any(|r| !r.valid())
    {
        return Err("pointer capture regions are empty or invalid".to_owned());
    }
    let state = STATE
        .get()
        .ok_or_else(|| "pointer-region hit testing is not installed".to_owned())?;
    let mut state = state
        .write()
        .map_err(|_| "pointer-region state lock is poisoned".to_owned())?;
    state.regions = regions;
    state.initialized = true;
    Ok(())
}

unsafe extern "system" fn pointer_region_window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let state = STATE.get();
    if message == WM_MOUSEMOVE && !SUSPENDED.load(Ordering::Acquire) {
        let mut tracking = TRACKMOUSEEVENT {
            cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
            dwFlags: TME_LEAVE,
            hwndTrack: hwnd,
            dwHoverTime: 0,
        };
        unsafe {
            TrackMouseEvent(&mut tracking);
        }
    } else if message == WM_MOUSELEAVE && !SUSPENDED.load(Ordering::Acquire) {
        notify_pointer_left();
    }

    if message == WM_NCHITTEST && !SUSPENDED.load(Ordering::Acquire) {
        if let Some(state) = state.and_then(|state| state.try_read().ok()) {
            if state.initialized {
                let screen_x = (lparam as u32 & 0xffff) as u16 as i16 as i32;
                let screen_y = ((lparam as u32 >> 16) & 0xffff) as u16 as i16 as i32;
                let mut window_rect = RECT::default();
                if unsafe { GetWindowRect(hwnd, &mut window_rect) } != 0 {
                    let client_x = screen_x.saturating_sub(window_rect.left);
                    let client_y = screen_y.saturating_sub(window_rect.top);
                    let inside = state
                        .regions
                        .iter()
                        .any(|region| region.contains(client_x, client_y));
                    if inside {
                        POINTER_INSIDE.store(true, Ordering::Release);
                        return HTCLIENT as LRESULT;
                    }
                    notify_pointer_left();
                    return HTTRANSPARENT as LRESULT;
                }
            }
        }
    }

    let original = ORIGINAL_WINDOW_PROC.load(Ordering::Acquire);
    if original == 0 {
        return 0;
    }
    let original: WNDPROC = Some(unsafe { std::mem::transmute(original) });
    unsafe { CallWindowProcW(original, hwnd, message, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn region_edges_are_half_open() {
        let region = PointerRegion {
            left: 20,
            top: 30,
            width: 100,
            height: 80,
        };

        assert!(region.contains(20, 30));
        assert!(region.contains(119, 109));
        assert!(!region.contains(120, 109));
        assert!(!region.contains(119, 110));
        assert!(!region.contains(19, 30));
    }

    #[test]
    fn invalid_or_empty_regions_are_rejected_before_installation_lookup() {
        assert!(set_pointer_capture_regions(Vec::new()).is_err());
        assert!(set_pointer_capture_regions(vec![PointerRegion {
            left: 0,
            top: 0,
            width: 0,
            height: 10,
        }])
        .is_err());
    }
}
