use tauri::{Monitor, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, Window};

const SAFE_MARGIN_LOGICAL_PX: f64 = 16.0;
// The default pet image has 37 logical pixels of horizontal transparent
// padding inside the native window. Allow almost that padding to cross an
// outer edge, while keeping the visible pet and controls on-screen.
const MAX_EDGE_OVERFLOW_LOGICAL_PX: f64 = 36.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Rect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl Rect {
    fn right(self) -> i64 {
        i64::from(self.x) + i64::from(self.width)
    }

    fn bottom(self) -> i64 {
        i64::from(self.y) + i64::from(self.height)
    }

    fn has_area(self) -> bool {
        self.width > 0 && self.height > 0
    }

    fn intersects(self, other: Self) -> bool {
        self.has_area()
            && other.has_area()
            && i64::from(self.x) < other.right()
            && self.right() > i64::from(other.x)
            && i64::from(self.y) < other.bottom()
            && self.bottom() > i64::from(other.y)
    }

    fn intersection_area(self, other: Self) -> u128 {
        let width = (self.right().min(other.right()) - i64::from(self.x).max(i64::from(other.x)))
            .max(0) as u128;
        let height = (self.bottom().min(other.bottom()) - i64::from(self.y).max(i64::from(other.y)))
            .max(0) as u128;
        width * height
    }
}

#[derive(Debug, Clone, Copy)]
struct DisplayGeometry {
    bounds: Rect,
    work_area: Rect,
    scale_factor: f64,
    is_primary: bool,
}

/// Moves a fully off-screen window back into the nearest monitor's work area.
///
/// The function is deliberately based only on Tauri's cross-platform monitor
/// APIs. A window that still overlaps any display is left untouched, preserving
/// intentional edge placement.
pub fn recover_if_offscreen<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<bool> {
    recover_window(window)
}

pub fn recover_native_window_if_offscreen<R: Runtime>(window: &Window<R>) -> tauri::Result<bool> {
    recover_window(window)
}

/// Keeps a moved window reachable within the available monitor work areas.
///
/// Adjacent monitors are treated as one continuous surface, so a window may
/// straddle their shared edge while it is being dragged. A bounded portion may
/// also extend beyond an outer edge so the pet can be docked where the pointer
/// can actually reach, while only the window's transparent edge padding may
/// leave the work area.
pub fn constrain_native_window_to_work_areas<R: Runtime>(
    window: &Window<R>,
) -> tauri::Result<bool> {
    constrain_window(window)
}

trait WindowMonitorApi {
    fn outer_position(&self) -> tauri::Result<PhysicalPosition<i32>>;
    fn outer_size(&self) -> tauri::Result<PhysicalSize<u32>>;
    fn primary_monitor(&self) -> tauri::Result<Option<Monitor>>;
    fn available_monitors(&self) -> tauri::Result<Vec<Monitor>>;
    fn set_physical_position(&self, position: PhysicalPosition<i32>) -> tauri::Result<()>;
}

impl<R: Runtime> WindowMonitorApi for WebviewWindow<R> {
    fn outer_position(&self) -> tauri::Result<PhysicalPosition<i32>> {
        WebviewWindow::outer_position(self)
    }

    fn outer_size(&self) -> tauri::Result<PhysicalSize<u32>> {
        WebviewWindow::outer_size(self)
    }

    fn primary_monitor(&self) -> tauri::Result<Option<Monitor>> {
        WebviewWindow::primary_monitor(self)
    }

    fn available_monitors(&self) -> tauri::Result<Vec<Monitor>> {
        WebviewWindow::available_monitors(self)
    }

    fn set_physical_position(&self, position: PhysicalPosition<i32>) -> tauri::Result<()> {
        WebviewWindow::set_position(self, position)
    }
}

impl<R: Runtime> WindowMonitorApi for Window<R> {
    fn outer_position(&self) -> tauri::Result<PhysicalPosition<i32>> {
        Window::outer_position(self)
    }

    fn outer_size(&self) -> tauri::Result<PhysicalSize<u32>> {
        Window::outer_size(self)
    }

    fn primary_monitor(&self) -> tauri::Result<Option<Monitor>> {
        Window::primary_monitor(self)
    }

    fn available_monitors(&self) -> tauri::Result<Vec<Monitor>> {
        Window::available_monitors(self)
    }

    fn set_physical_position(&self, position: PhysicalPosition<i32>) -> tauri::Result<()> {
        Window::set_position(self, position)
    }
}

fn recover_window<W: WindowMonitorApi>(window: &W) -> tauri::Result<bool> {
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    if size.width == 0 || size.height == 0 {
        return Ok(false);
    }

    let primary = window.primary_monitor().ok().flatten();
    let monitors = match window.available_monitors() {
        Ok(monitors) if !monitors.is_empty() => monitors,
        Ok(_) => primary.iter().cloned().collect(),
        Err(error) => match primary.as_ref() {
            Some(primary) => vec![primary.clone()],
            None => return Err(error),
        },
    };

    let displays: Vec<_> = monitors
        .iter()
        .map(|monitor| DisplayGeometry {
            bounds: monitor_bounds(monitor),
            work_area: monitor_work_area(monitor),
            scale_factor: monitor.scale_factor(),
            is_primary: primary
                .as_ref()
                .is_some_and(|primary| same_monitor(monitor, primary)),
        })
        .collect();
    let window_rect = Rect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };

    let Some(position) = recovery_position(window_rect, &displays) else {
        return Ok(false);
    };

    window.set_physical_position(PhysicalPosition::new(position.0, position.1))?;
    Ok(true)
}

fn constrain_window<W: WindowMonitorApi>(window: &W) -> tauri::Result<bool> {
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    if size.width == 0 || size.height == 0 {
        return Ok(false);
    }

    let primary = window.primary_monitor().ok().flatten();
    let monitors = match window.available_monitors() {
        Ok(monitors) if !monitors.is_empty() => monitors,
        Ok(_) => primary.iter().cloned().collect(),
        Err(error) => match primary.as_ref() {
            Some(primary) => vec![primary.clone()],
            None => return Err(error),
        },
    };
    let displays: Vec<_> = monitors
        .iter()
        .map(|monitor| DisplayGeometry {
            bounds: monitor_bounds(monitor),
            work_area: monitor_work_area(monitor),
            scale_factor: monitor.scale_factor(),
            is_primary: primary
                .as_ref()
                .is_some_and(|primary| same_monitor(monitor, primary)),
        })
        .collect();
    let window_rect = Rect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };

    let Some(position) = containment_position(window_rect, &displays) else {
        return Ok(false);
    };
    window.set_physical_position(PhysicalPosition::new(position.0, position.1))?;
    Ok(true)
}

fn monitor_bounds(monitor: &Monitor) -> Rect {
    Rect {
        x: monitor.position().x,
        y: monitor.position().y,
        width: monitor.size().width,
        height: monitor.size().height,
    }
}

fn monitor_work_area(monitor: &Monitor) -> Rect {
    let work_area = monitor.work_area();
    let rect = Rect {
        x: work_area.position.x,
        y: work_area.position.y,
        width: work_area.size.width,
        height: work_area.size.height,
    };
    if rect.has_area() {
        rect
    } else {
        monitor_bounds(monitor)
    }
}

fn same_monitor(left: &Monitor, right: &Monitor) -> bool {
    left.position().x == right.position().x
        && left.position().y == right.position().y
        && left.size().width == right.size().width
        && left.size().height == right.size().height
}

fn recovery_position(window: Rect, displays: &[DisplayGeometry]) -> Option<(i32, i32)> {
    if displays.is_empty()
        || displays
            .iter()
            .any(|display| window.intersects(display.bounds))
    {
        return None;
    }

    let target = displays.iter().min_by_key(|display| {
        (
            rect_distance_squared(window, display.bounds),
            u8::from(!display.is_primary),
        )
    })?;
    let margin = scaled_margin(target.scale_factor);
    Some((
        fit_axis(
            window.x,
            window.width,
            target.work_area.x,
            target.work_area.width,
            margin,
        ),
        fit_axis(
            window.y,
            window.height,
            target.work_area.y,
            target.work_area.height,
            margin,
        ),
    ))
}

fn containment_position(window: Rect, displays: &[DisplayGeometry]) -> Option<(i32, i32)> {
    if displays.is_empty() {
        return None;
    }
    if rect_fully_covered(window, displays.iter().map(|display| display.work_area))
        || displays
            .iter()
            .any(|display| window_fits_edge_allowance(window, *display))
    {
        return None;
    }

    let target = displays
        .iter()
        .filter(|display| window.intersection_area(display.work_area) > 0)
        .max_by_key(|display| {
            (
                window.intersection_area(display.work_area),
                u8::from(display.is_primary),
            )
        })
        .or_else(|| {
            displays.iter().min_by_key(|display| {
                (
                    rect_distance_squared(window, display.bounds),
                    u8::from(!display.is_primary),
                )
            })
        })?;

    Some((
        fit_axis_with_overflow(
            window.x,
            window.width,
            target.work_area.x,
            target.work_area.width,
            scaled_edge_overflow(target.scale_factor),
        ),
        fit_axis_with_overflow(
            window.y,
            window.height,
            target.work_area.y,
            target.work_area.height,
            scaled_edge_overflow(target.scale_factor),
        ),
    ))
}

fn window_fits_edge_allowance(window: Rect, display: DisplayGeometry) -> bool {
    let overflow = i64::from(scaled_edge_overflow(display.scale_factor));
    i64::from(window.x) >= i64::from(display.work_area.x) - overflow
        && window.right() <= display.work_area.right() + overflow
        && i64::from(window.y) >= i64::from(display.work_area.y) - overflow
        && window.bottom() <= display.work_area.bottom() + overflow
}

fn scaled_edge_overflow(scale_factor: f64) -> u32 {
    let scale_factor = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    (MAX_EDGE_OVERFLOW_LOGICAL_PX * scale_factor)
        .round()
        .clamp(1.0, 512.0) as u32
}

fn fit_axis_with_overflow(
    current: i32,
    window_length: u32,
    work_start: i32,
    work_length: u32,
    requested_overflow: u32,
) -> i32 {
    let start = i64::from(work_start);
    let window_length = i64::from(window_length);
    let work_length = i64::from(work_length);
    let overflow = i64::from(requested_overflow).min(work_length / 2);
    let minimum = start - overflow;
    let maximum = start + work_length - window_length + overflow;
    let fitted = if maximum >= minimum {
        i64::from(current).clamp(minimum, maximum)
    } else {
        start + (work_length - window_length) / 2
    };
    fitted.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

fn rect_fully_covered(rect: Rect, covers: impl Iterator<Item = Rect>) -> bool {
    if !rect.has_area() {
        return false;
    }
    let covers: Vec<_> = covers.filter(|cover| rect.intersects(*cover)).collect();
    if covers.is_empty() {
        return false;
    }

    let left = i64::from(rect.x);
    let right = rect.right();
    let top = i64::from(rect.y);
    let bottom = rect.bottom();
    let mut x_edges = vec![left, right];
    for cover in &covers {
        x_edges.push(i64::from(cover.x).clamp(left, right));
        x_edges.push(cover.right().clamp(left, right));
    }
    x_edges.sort_unstable();
    x_edges.dedup();

    x_edges.windows(2).all(|slice| {
        let x_start = slice[0];
        let x_end = slice[1];
        if x_start == x_end {
            return true;
        }
        let mut intervals: Vec<_> = covers
            .iter()
            .filter(|cover| i64::from(cover.x) <= x_start && cover.right() >= x_end)
            .map(|cover| {
                (
                    i64::from(cover.y).clamp(top, bottom),
                    cover.bottom().clamp(top, bottom),
                )
            })
            .filter(|(start, end)| start < end)
            .collect();
        intervals.sort_unstable();

        let mut covered_until = top;
        for (start, end) in intervals {
            if start > covered_until {
                return false;
            }
            covered_until = covered_until.max(end);
            if covered_until >= bottom {
                return true;
            }
        }
        false
    })
}

fn rect_distance_squared(left: Rect, right: Rect) -> i128 {
    let horizontal = axis_distance(
        i64::from(left.x),
        left.right(),
        i64::from(right.x),
        right.right(),
    );
    let vertical = axis_distance(
        i64::from(left.y),
        left.bottom(),
        i64::from(right.y),
        right.bottom(),
    );
    i128::from(horizontal) * i128::from(horizontal) + i128::from(vertical) * i128::from(vertical)
}

fn axis_distance(left_start: i64, left_end: i64, right_start: i64, right_end: i64) -> i64 {
    if left_end < right_start {
        right_start - left_end
    } else if right_end < left_start {
        left_start - right_end
    } else {
        0
    }
}

fn scaled_margin(scale_factor: f64) -> u32 {
    let scale_factor = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    (SAFE_MARGIN_LOGICAL_PX * scale_factor)
        .round()
        .clamp(0.0, 256.0) as u32
}

fn fit_axis(
    current: i32,
    window_length: u32,
    work_start: i32,
    work_length: u32,
    requested_margin: u32,
) -> i32 {
    let start = i64::from(work_start);
    let work_length = i64::from(work_length);
    let window_length = i64::from(window_length);
    let margin = i64::from(requested_margin).min(work_length / 2);
    let minimum = start + margin;
    let maximum = start + work_length - margin - window_length;

    let fitted = if maximum >= minimum {
        i64::from(current).clamp(minimum, maximum)
    } else {
        // An oversized window cannot be fully contained. Centering maximizes
        // the visible portion while keeping the behavior deterministic.
        start + (work_length - window_length) / 2
    };
    fitted.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(bounds: Rect, work_area: Rect, is_primary: bool) -> DisplayGeometry {
        DisplayGeometry {
            bounds,
            work_area,
            scale_factor: 1.0,
            is_primary,
        }
    }

    fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn preserves_any_position_that_still_overlaps_a_display() {
        let monitor = display(rect(0, 0, 1920, 1080), rect(0, 0, 1920, 1040), true);

        assert_eq!(
            recovery_position(rect(1919, 500, 360, 440), &[monitor]),
            None
        );
        assert_eq!(
            recovery_position(rect(100, 1039, 360, 440), &[monitor]),
            None
        );
    }

    #[test]
    fn recovers_to_nearest_monitor_and_respects_work_area_margin() {
        let left = display(rect(0, 0, 1920, 1080), rect(0, 0, 1920, 1040), true);
        let right = display(rect(1920, 0, 2560, 1440), rect(1920, 0, 2560, 1400), false);

        assert_eq!(
            recovery_position(rect(5000, 1600, 360, 440), &[left, right]),
            Some((4104, 944))
        );
    }

    #[test]
    fn returns_removed_monitor_position_to_primary_display() {
        let primary = display(rect(0, 0, 1920, 1080), rect(0, 0, 1920, 1040), true);

        assert_eq!(
            recovery_position(rect(-1800, 200, 360, 440), &[primary]),
            Some((16, 200))
        );
    }

    #[test]
    fn supports_negative_monitor_coordinates() {
        let left = display(
            rect(-1920, 0, 1920, 1080),
            rect(-1920, 0, 1920, 1040),
            false,
        );
        let primary = display(rect(0, 0, 1920, 1080), rect(0, 0, 1920, 1040), true);

        assert_eq!(
            recovery_position(rect(-2400, 200, 360, 440), &[left, primary]),
            Some((-1904, 200))
        );
    }

    #[test]
    fn prefers_primary_monitor_when_distances_are_equal() {
        let left = display(
            rect(-1920, 0, 1920, 1080),
            rect(-1920, 0, 1920, 1040),
            false,
        );
        let right_primary = display(rect(1920, 0, 1920, 1080), rect(1920, 0, 1920, 1040), true);

        assert_eq!(
            recovery_position(rect(780, 1400, 360, 440), &[left, right_primary]),
            Some((1936, 584))
        );
    }

    #[test]
    fn uses_target_monitor_scale_for_the_safe_margin() {
        let monitor = DisplayGeometry {
            bounds: rect(0, 0, 2560, 1440),
            work_area: rect(0, 0, 2560, 1400),
            scale_factor: 2.0,
            is_primary: true,
        };

        assert_eq!(
            recovery_position(rect(3000, -800, 360, 440), &[monitor]),
            Some((2168, 32))
        );
    }

    #[test]
    fn empty_monitor_list_and_oversized_window_are_safe() {
        assert_eq!(recovery_position(rect(0, 0, 360, 440), &[]), None);

        let tiny = display(rect(0, 0, 200, 100), rect(0, 0, 200, 100), true);
        assert_eq!(
            recovery_position(rect(300, 300, 400, 300), &[tiny]),
            Some((-100, -100))
        );
    }

    #[test]
    fn constrains_each_outer_work_area_edge() {
        let monitor = display(rect(0, 0, 1920, 1080), rect(0, 0, 1920, 1040), true);

        assert_eq!(
            containment_position(rect(-300, 120, 360, 440), &[monitor]),
            Some((-36, 120))
        );
        assert_eq!(
            containment_position(rect(1870, 120, 360, 440), &[monitor]),
            Some((1596, 120))
        );
        assert_eq!(
            containment_position(rect(120, -400, 360, 440), &[monitor]),
            Some((120, -36))
        );
        assert_eq!(
            containment_position(rect(120, 990, 360, 440), &[monitor]),
            Some((120, 636))
        );
    }

    #[test]
    fn allows_only_transparent_padding_to_cross_an_outer_edge() {
        let monitor = display(rect(0, 0, 1920, 1080), rect(0, 0, 1920, 1040), true);

        assert_eq!(
            containment_position(rect(-36, -36, 360, 440), &[monitor]),
            None
        );
        assert_eq!(
            containment_position(rect(1596, 636, 360, 440), &[monitor]),
            None
        );
    }

    #[test]
    fn allows_a_window_to_cross_a_shared_monitor_edge() {
        let left = display(rect(0, 0, 1920, 1080), rect(0, 0, 1920, 1040), true);
        let right = display(rect(1920, 0, 2560, 1440), rect(1920, 0, 2560, 1400), false);

        assert_eq!(
            containment_position(rect(1760, 120, 360, 440), &[left, right]),
            None
        );
    }

    #[test]
    fn rejects_a_gap_between_monitor_work_areas() {
        let left = display(rect(0, 0, 1000, 1000), rect(0, 0, 1000, 900), true);
        let right = display(
            rect(1000, 100, 1000, 1000),
            rect(1000, 100, 1000, 900),
            false,
        );

        assert_eq!(
            containment_position(rect(900, 20, 300, 200), &[left, right]),
            Some((964, 64))
        );
    }
}
