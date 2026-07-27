const MINI_OPACITY_MIN: f64 = 0.35;
const MINI_OPACITY_MAX: f64 = 1.0;

#[tauri::command]
fn set_window_opacity(window: tauri::Window, opacity: f64) -> Result<(), String> {
    set_native_window_opacity(window, opacity)
}

#[cfg(windows)]
fn set_native_window_opacity(window: tauri::Window, opacity: f64) -> Result<(), String> {
    use std::ffi::c_void;

    type Hwnd = *mut c_void;

    const GWL_EXSTYLE: i32 = -20;
    const LWA_ALPHA: u32 = 0x00000002;
    const WS_EX_LAYERED: i32 = 0x00080000;

    #[link(name = "user32")]
    extern "system" {
        fn GetWindowLongW(hwnd: Hwnd, index: i32) -> i32;
        fn SetWindowLongW(hwnd: Hwnd, index: i32, new_long: i32) -> i32;
        fn SetLayeredWindowAttributes(
            hwnd: Hwnd,
            color_key: u32,
            alpha: u8,
            flags: u32,
        ) -> i32;
    }

    let opacity = opacity.clamp(MINI_OPACITY_MIN, MINI_OPACITY_MAX);
    let alpha = (opacity * 255.0).round() as u8;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;

    unsafe {
        let extended_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        SetWindowLongW(hwnd, GWL_EXSTYLE, extended_style | WS_EX_LAYERED);
        if SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA) == 0 {
            return Err("failed to set layered window opacity".into());
        }
    }

    Ok(())
}

#[cfg(not(windows))]
fn set_native_window_opacity(_window: tauri::Window, _opacity: f64) -> Result<(), String> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![set_window_opacity])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
