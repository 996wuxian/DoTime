use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MINI_OPACITY_MIN: f64 = 0.35;
const MINI_OPACITY_MAX: f64 = 1.0;
const REMINDER_WINDOW_WIDTH: f64 = 620.0;
const REMINDER_WINDOW_HEIGHT: f64 = 380.0;
const REMINDER_WINDOW_MARGIN: f64 = 16.0;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder,
};

struct ReminderState(Mutex<Option<String>>);
struct ReminderScheduleState(Mutex<u64>);

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledReminder {
    id: String,
    title: String,
    reminder_time: String,
    due_at: i64,
}

#[tauri::command]
fn set_window_opacity(window: tauri::Window, opacity: f64) -> Result<(), String> {
    set_native_window_opacity(window, opacity)
}

#[tauri::command]
fn hide_main_window(window: tauri::Window) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn close_reminder_window(window: tauri::Window) -> Result<(), String> {
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn show_reminder_window(
    app: tauri::AppHandle,
    state: State<'_, ReminderState>,
    reminder_group: String,
) -> Result<(), String> {
    *state.0.lock().map_err(|error| error.to_string())? = Some(reminder_group.clone());
    show_reminder_window_inner(&app, reminder_group)
}

fn show_reminder_window_inner(
    app: &tauri::AppHandle,
    reminder_group: String,
) -> Result<(), String> {
    let window = match app.get_webview_window("reminder") {
        Some(window) => window,
        None => WebviewWindowBuilder::new(
            app,
            "reminder",
            WebviewUrl::App("index.html?view=reminder".into()),
        )
        .title("doTime 提醒")
        .visible(false)
        .decorations(false)
        .transparent(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .inner_size(REMINDER_WINDOW_WIDTH, REMINDER_WINDOW_HEIGHT)
        .build()
        .map_err(|error| error.to_string())?,
    };

    position_reminder_window(&window);

    let _ = window.unminimize();
    window.show().map_err(|error| error.to_string())?;
    let _ = window.emit("dotime-reminder-group", reminder_group);
    Ok(())
}

#[tauri::command]
fn schedule_reminders(
    app: tauri::AppHandle,
    state: State<'_, ReminderScheduleState>,
    reminders: Vec<ScheduledReminder>,
) -> Result<(), String> {
    let generation = {
        let mut current = state.0.lock().map_err(|error| error.to_string())?;
        *current += 1;
        *current
    };

    thread::spawn(move || run_reminder_schedule(app, generation, reminders));
    Ok(())
}

#[tauri::command]
fn get_active_reminder_group(state: State<'_, ReminderState>) -> Result<Option<String>, String> {
    state
        .0
        .lock()
        .map(|group| group.clone())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_active_reminder_group(state: State<'_, ReminderState>) -> Result<(), String> {
    *state.0.lock().map_err(|error| error.to_string())? = None;
    Ok(())
}

fn run_reminder_schedule(
    app: tauri::AppHandle,
    generation: u64,
    reminders: Vec<ScheduledReminder>,
) {
    let mut pending: Vec<ScheduledReminder> = reminders
        .into_iter()
        .filter(|reminder| reminder.due_at > 0)
        .collect();

    loop {
        if !is_reminder_schedule_current(&app, generation) {
            return;
        }

        if pending.is_empty() {
            return;
        }

        let now = current_timestamp_millis();
        let mut due_items = Vec::new();
        let mut future_items = Vec::new();

        for reminder in pending {
            if reminder.due_at <= now {
                due_items.push(reminder);
            } else {
                future_items.push(reminder);
            }
        }

        if !due_items.is_empty() {
            if !is_reminder_schedule_current(&app, generation) {
                return;
            }

            let reminder_group = serde_json::json!({
                "id": format!("reminder-{}", now),
                "firedAt": now,
                "updatedAt": now,
                "items": due_items
                    .iter()
                    .map(|reminder| serde_json::json!({
                        "id": reminder.id,
                        "title": reminder.title,
                        "reminderTime": reminder.reminder_time,
                        "dueAt": reminder.due_at,
                    }))
                    .collect::<Vec<_>>(),
            });

            if let Ok(reminder_group) = serde_json::to_string(&reminder_group) {
                if let Some(state) = app.try_state::<ReminderState>() {
                    if let Ok(mut active_group) = state.0.lock() {
                        *active_group = Some(reminder_group.clone());
                    }
                }
                let _ = show_reminder_window_inner(&app, reminder_group);
            }
        }

        pending = future_items;
        let next_due_at = pending.iter().map(|reminder| reminder.due_at).min();
        let Some(next_due_at) = next_due_at else {
            return;
        };

        let delay_ms = (next_due_at - current_timestamp_millis()).clamp(0, 60_000);
        thread::sleep(Duration::from_millis(delay_ms as u64));
    }
}

fn is_reminder_schedule_current(app: &tauri::AppHandle, generation: u64) -> bool {
    app.try_state::<ReminderScheduleState>()
        .and_then(|state| state.0.lock().ok().map(|current| *current == generation))
        .unwrap_or(false)
}

fn current_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn position_reminder_window(window: &tauri::WebviewWindow) {
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let work_area = monitor.work_area();
        let x = work_area.position.x as f64 + work_area.size.width as f64
            - REMINDER_WINDOW_WIDTH
            - REMINDER_WINDOW_MARGIN;
        let y = work_area.position.y as f64 + work_area.size.height as f64
            - REMINDER_WINDOW_HEIGHT
            - REMINDER_WINDOW_MARGIN;
        let _ = window.set_position(PhysicalPosition::new(x, y));
        let _ = window.set_size(PhysicalSize::new(
            REMINDER_WINDOW_WIDTH,
            REMINDER_WINDOW_HEIGHT,
        ));
    }
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
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
        fn SetLayeredWindowAttributes(hwnd: Hwnd, color_key: u32, alpha: u8, flags: u32) -> i32;
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
        .manage(ReminderState(Mutex::new(None)))
        .manage(ReminderScheduleState(Mutex::new(0)))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show-main", "显示主窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 doTime", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .tooltip("doTime")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show-main" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                    | TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } => show_main_window(tray.app_handle()),
                    _ => {}
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }

            tray_builder.build(app)?;
            if let Some(window) = app.get_webview_window("reminder") {
                position_reminder_window(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_window_opacity,
            hide_main_window,
            close_reminder_window,
            show_reminder_window,
            schedule_reminders,
            get_active_reminder_group,
            clear_active_reminder_group
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
