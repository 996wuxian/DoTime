use std::sync::{
    mpsc::{self, Receiver, RecvTimeoutError, Sender},
    Mutex,
};
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
struct ReminderScheduleState(Sender<Vec<ScheduledReminder>>);

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
    state: State<'_, ReminderScheduleState>,
    reminders: Vec<ScheduledReminder>,
) -> Result<(), String> {
    state.0.send(reminders).map_err(|error| error.to_string())
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

fn normalize_reminders(reminders: Vec<ScheduledReminder>) -> Vec<ScheduledReminder> {
    reminders
        .into_iter()
        .filter(|reminder| reminder.due_at > 0)
        .collect()
}

fn run_reminder_scheduler(app: tauri::AppHandle, receiver: Receiver<Vec<ScheduledReminder>>) {
    let mut pending = Vec::new();

    loop {
        if pending.is_empty() {
            let Ok(reminders) = receiver.recv() else {
                return;
            };
            pending = normalize_reminders(reminders);
        }

        while let Ok(reminders) = receiver.try_recv() {
            pending = normalize_reminders(reminders);
        }

        if pending.is_empty() {
            continue;
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
                let fired_ids = due_items
                    .iter()
                    .map(|reminder| reminder.id.clone())
                    .collect::<Vec<_>>();
                if let Some(state) = app.try_state::<ReminderState>() {
                    if let Ok(mut active_group) = state.0.lock() {
                        *active_group = Some(reminder_group.clone());
                    }
                }
                match show_reminder_window_inner(&app, reminder_group) {
                    Ok(()) => {
                        let _ = app.emit(
                            "dotime-reminder-fired",
                            serde_json::json!({ "ids": fired_ids, "firedAt": now }),
                        );
                    }
                    Err(error) => {
                        eprintln!("failed to show reminder window: {error}");
                    }
                }
            }
        }

        pending = future_items;
        let next_due_at = pending.iter().map(|reminder| reminder.due_at).min();
        let Some(next_due_at) = next_due_at else {
            continue;
        };

        let delay_ms = (next_due_at - current_timestamp_millis()).clamp(0, 60_000);
        match receiver.recv_timeout(Duration::from_millis(delay_ms as u64)) {
            Ok(reminders) => pending = normalize_reminders(reminders),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
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
    let (reminder_schedule_sender, reminder_schedule_receiver) = mpsc::channel();

    tauri::Builder::default()
        .manage(ReminderState(Mutex::new(None)))
        .manage(ReminderScheduleState(reminder_schedule_sender))
        .setup(move |app| {
            let reminder_app = app.handle().clone();
            thread::spawn(move || run_reminder_scheduler(reminder_app, reminder_schedule_receiver));

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
