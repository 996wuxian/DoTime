use crate::pinned_layout::Frame;

#[cfg(windows)]
mod windows {
    use std::ffi::c_void;

    #[repr(C)]
    #[derive(Clone, Copy, Debug, Default, PartialEq)]
    pub struct Rect {
        pub left: i32,
        pub top: i32,
        pub right: i32,
        pub bottom: i32,
    }

    #[link(name = "user32")]
    extern "system" {
        pub fn GetWindowRgnBox(hwnd: *mut c_void, rect: *mut Rect) -> i32;
        pub fn GetWindowRgn(hwnd: *mut c_void, region: *mut c_void) -> i32;
        pub fn SetWindowRgn(hwnd: *mut c_void, region: *mut c_void, redraw: i32) -> i32;
    }
    #[link(name = "gdi32")]
    extern "system" {
        pub fn CreateRectRgn(left: i32, top: i32, right: i32, bottom: i32) -> *mut c_void;
        pub fn CreateRoundRectRgn(
            left: i32,
            top: i32,
            right: i32,
            bottom: i32,
            ellipse_width: i32,
            ellipse_height: i32,
        ) -> *mut c_void;
        pub fn CombineRgn(
            destination: *mut c_void,
            first: *mut c_void,
            second: *mut c_void,
            mode: i32,
        ) -> i32;
        pub fn EqualRgn(first: *mut c_void, second: *mut c_void) -> i32;
        #[cfg(test)]
        pub fn PtInRegion(region: *mut c_void, x: i32, y: i32) -> i32;
        pub fn DeleteObject(object: *mut c_void) -> i32;
    }

    pub(super) struct Region(pub(super) *mut c_void);
    impl Drop for Region {
        fn drop(&mut self) {
            unsafe {
                DeleteObject(self.0);
            }
        }
    }
    impl Region {
        unsafe fn new(handle: *mut c_void) -> Result<Self, String> {
            if handle.is_null() {
                Err("failed to create pinned window region".into())
            } else {
                Ok(Self(handle))
            }
        }
    }

    pub(super) unsafe fn clip_region(rect: Rect, radius: i32) -> Result<Region, String> {
        const RGN_AND: i32 = 1;
        const RGN_OR: i32 = 2;
        let bounds = Region::new(CreateRectRgn(rect.left, rect.top, rect.right, rect.bottom))?;
        let radius = radius
            .max(0)
            .min((rect.right - rect.left) / 2)
            .min((rect.bottom - rect.top) / 2);
        if radius == 0 {
            return Ok(bounds);
        }
        // HRGNs have binary coverage. Cutting at the CSS radius discards the
        // WebView's partially transparent edge pixels and exposes a staircase.
        // Dilate the curved boundary by two physical pixels (also covering DPI
        // rounding), then let CSS render the actual 12px antialiased corners.
        // Keep the exact outer bounds so this cannot expose the old white strip.
        const ANTIALIAS_PADDING: i32 = 2;
        let rounded = Region::new(CreateRoundRectRgn(
            rect.left - ANTIALIAS_PADDING,
            rect.top - ANTIALIAS_PADDING,
            rect.right + 1 + ANTIALIAS_PADDING,
            rect.bottom + 1 + ANTIALIAS_PADDING,
            (radius + ANTIALIAS_PADDING) * 2,
            (radius + ANTIALIAS_PADDING) * 2,
        ))?;
        let square_right = Region::new(CreateRectRgn(
            rect.left + radius,
            rect.top,
            rect.right,
            rect.bottom,
        ))?;
        // Leave the screen-facing right edge square. Intersect to keep exact
        // exclusive bounds while the native curve stays outside the CSS curve.
        if CombineRgn(rounded.0, rounded.0, square_right.0, RGN_OR) == 0
            || CombineRgn(rounded.0, rounded.0, bounds.0, RGN_AND) == 0
        {
            return Err("failed to combine pinned window region".into());
        }
        Ok(rounded)
    }

    pub(super) unsafe fn apply_clip(
        hwnd: *mut c_void,
        rect: Rect,
        radius: i32,
    ) -> Result<bool, String> {
        let region = clip_region(rect, radius)?;
        let current = Region::new(CreateRectRgn(0, 0, 0, 0))?;
        // Equal bounds do not imply equal shapes (rectangle vs rounded card).
        if GetWindowRgn(hwnd, current.0) != 0 && EqualRgn(current.0, region.0) != 0 {
            return Ok(false);
        }
        // Redraw the changed region so pixels exposed by a shrinking clip are
        // cleared. The HWND/WebView viewport stays the same size, avoiding the
        // resize/rebase path that caused the original animation flicker.
        if SetWindowRgn(hwnd, region.0, 1) == 0 {
            return Err("failed to set pinned window region".into());
        }
        // Windows owns this region after success; all temporary regions retain
        // ordinary RAII cleanup, including the failure and no-change paths.
        std::mem::forget(region);
        Ok(true)
    }
}

// Keep the WebView viewport alive at a stable size. Only its native visible /
// interactive region follows the card, so transparent space cannot eat clicks.
#[cfg(windows)]
pub fn set_clip(window: &tauri::Window, clip: Frame) -> Result<(), String> {
    use windows::*;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0;
    let rect = Rect {
        left: (clip.x * scale).floor() as i32,
        top: (clip.y * scale).floor() as i32,
        right: ((clip.x + clip.width) * scale).ceil() as i32,
        bottom: ((clip.y + clip.height) * scale).ceil() as i32,
    };
    let radius = if window.label().starts_with("pinned-todo-") {
        (12.0 * scale).round() as i32
    } else {
        0
    };
    unsafe { windows::apply_clip(hwnd, rect, radius) }.map(|_| ())
}

#[cfg(not(windows))]
pub fn set_clip(_window: &tauri::Window, _clip: Frame) -> Result<(), String> {
    Ok(())
}

pub fn visible_frame(window: &tauri::Window) -> Result<Frame, String> {
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let frame = Frame {
        x: position.x as f64 / scale,
        y: position.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
    };
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0;
        let mut rect = windows::Rect::default();
        if unsafe { windows::GetWindowRgnBox(hwnd, &mut rect) } > 1 {
            return Ok(Frame {
                x: frame.x + rect.left as f64 / scale,
                y: frame.y + rect.top as f64 / scale,
                width: (rect.right - rect.left) as f64 / scale,
                height: (rect.bottom - rect.top) as f64 / scale,
            });
        }
    }
    Ok(frame)
}

#[cfg(all(test, windows))]
mod tests {
    use super::windows::*;
    use std::ffi::c_void;

    #[link(name = "user32")]
    extern "system" {
        fn CreateWindowExW(
            ex_style: u32,
            class: *const u16,
            name: *const u16,
            style: u32,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            parent: *mut c_void,
            menu: *mut c_void,
            instance: *mut c_void,
            param: *mut c_void,
        ) -> *mut c_void;
        fn DestroyWindow(hwnd: *mut c_void) -> i32;
        fn GetClientRect(hwnd: *mut c_void, rect: *mut Rect) -> i32;
    }

    struct HiddenWindow(*mut c_void);
    impl Drop for HiddenWindow {
        fn drop(&mut self) {
            unsafe {
                DestroyWindow(self.0);
            }
        }
    }

    #[test]
    fn native_clip_changes_do_not_resize_the_webview_viewport() {
        unsafe {
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let hwnd = HiddenWindow(CreateWindowExW(
                0,
                class.as_ptr(),
                std::ptr::null(),
                0x80000000,
                0,
                0,
                420,
                1040,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            ));
            assert!(
                !hwnd.0.is_null(),
                "could not create hidden native test window"
            );
            let mut before = Rect::default();
            assert_ne!(GetClientRect(hwnd.0, &mut before), 0);
            for clip in [
                Rect {
                    left: 210,
                    top: 18,
                    right: 420,
                    bottom: 64,
                },
                Rect {
                    left: 0,
                    top: 18,
                    right: 420,
                    bottom: 78,
                },
                Rect {
                    left: 210,
                    top: 250,
                    right: 420,
                    bottom: 296,
                },
                Rect {
                    left: 210,
                    top: 18,
                    right: 420,
                    bottom: 64,
                },
            ] {
                assert!(apply_clip(hwnd.0, clip, 0).unwrap());
                let mut region = Rect::default();
                assert_ne!(GetWindowRgnBox(hwnd.0, &mut region), 0);
                assert_eq!(region, clip);
                assert!(
                    !apply_clip(hwnd.0, clip, 0).unwrap(),
                    "identical clips must not repaint"
                );
                let mut after = Rect::default();
                assert_ne!(GetClientRect(hwnd.0, &mut after), 0);
                assert_eq!(
                    before, after,
                    "clip changes must not issue a viewport resize"
                );
            }
            let clip = Rect {
                left: 210,
                top: 18,
                right: 420,
                bottom: 64,
            };
            assert!(
                apply_clip(hwnd.0, clip, 12).unwrap(),
                "equal bounds must not skip a shape change"
            );
            let actual = Region(CreateRectRgn(0, 0, 0, 0));
            assert!(!actual.0.is_null());
            assert_ne!(GetWindowRgn(hwnd.0, actual.0), 0);
            assert_eq!(PtInRegion(actual.0, clip.left, clip.top), 0);
            assert_ne!(PtInRegion(actual.0, clip.right - 1, clip.top), 0);
            assert!(!apply_clip(hwnd.0, clip, 12).unwrap());
            assert!(apply_clip(hwnd.0, clip, 0).unwrap());
        }
    }

    #[test]
    fn native_parent_clip_preserves_left_rounding_in_both_sizes_and_scaled_coordinates() {
        unsafe {
            for scale in [1.0, 1.25, 1.5, 2.0] {
                for width in [210.0, 420.0] {
                    let rect = Rect {
                        left: 0,
                        top: 0,
                        right: (width * scale) as i32,
                        bottom: (60.0 * scale) as i32,
                    };
                    let radius = (12.0 * scale) as i32;
                    let region = clip_region(rect, radius).unwrap();
                    assert_eq!(PtInRegion(region.0, 0, 0), 0);
                    assert_eq!(PtInRegion(region.0, 0, rect.bottom - 1), 0);
                    assert_ne!(PtInRegion(region.0, radius, 0), 0);
                    assert_ne!(PtInRegion(region.0, 0, radius), 0);
                    assert_ne!(PtInRegion(region.0, rect.right - 1, 0), 0);
                    assert_ne!(PtInRegion(region.0, rect.right - 1, rect.bottom - 1), 0);
                }
            }
        }
    }

    #[test]
    fn native_clip_keeps_the_css_antialias_edge_at_different_scales_and_offsets() {
        unsafe {
            for scale in [1.0_f64, 1.25, 1.5, 1.75, 2.0] {
                for offset in [0.0_f64, 0.25, 0.5, 0.75] {
                    for (width, height) in [(210.0, 46.0), (420.0, 60.0)] {
                        let left = offset * scale;
                        let top = (18.0 + offset) * scale;
                        let bottom = top + height * scale;
                        let radius = 12.0 * scale;
                        let rect = Rect {
                            left: left.floor() as i32,
                            top: top.floor() as i32,
                            right: (left + width * scale).ceil() as i32,
                            bottom: bottom.ceil() as i32,
                        };
                        let region = clip_region(rect, radius.round() as i32).unwrap();
                        for y in rect.top..rect.bottom {
                            for x in rect.left..(left + radius).ceil() as i32 {
                                let center_x = left + radius;
                                let center_y =
                                    (y as f64 + 0.5).clamp(top + radius, bottom - radius);
                                // A partially covered pixel can contribute to CSS
                                // antialiasing even when its center is outside the
                                // curve. Reserve another half pixel for filtering.
                                let dx = (center_x - (x + 1) as f64).max(0.0);
                                let dy = (center_y - (y + 1) as f64)
                                    .max(y as f64 - center_y)
                                    .max(0.0);
                                if dx.hypot(dy) <= radius + 0.5 {
                                    assert_ne!(
                                        PtInRegion(region.0, x, y),
                                        0,
                                        "native clip cuts CSS edge at scale={scale}, offset={offset}, pixel=({x}, {y}), size=({width}, {height})"
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
