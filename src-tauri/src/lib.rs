use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
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
const MINI_SUBTASKS_WINDOW_WIDTH: f64 = 460.0;
const MINI_SUBTASKS_WINDOW_HEIGHT: f64 = 96.0;
const MINI_SUBTASKS_WINDOW_MAX_HEIGHT: f64 = 320.0;
const MINI_SUBTASKS_WINDOW_ROW_HEIGHT: f64 = 56.0;
const MINI_SUBTASKS_WINDOW_VERTICAL_CHROME: f64 = 22.0;
const MINI_SUBTASKS_WINDOW_MARGIN: f64 = 4.0;
const MINI_SUBTASKS_WINDOW_STACK_GAP: f64 = 4.0;
const MINI_SUBTASKS_PARENT_INSET: f64 = 18.0;
const PINNED_TODO_WINDOW_COLLAPSED_WIDTH: f64 = 210.0;
const PINNED_TODO_WINDOW_COLLAPSED_HEIGHT: f64 = 46.0;
const PINNED_TODO_WINDOW_EXPANDED_WIDTH: f64 = 420.0;
const PINNED_TODO_WINDOW_EXPANDED_HEIGHT: f64 = 60.0;
const PINNED_TODO_WINDOW_MARGIN: f64 = 18.0;
const PINNED_TODO_WINDOW_COUNT: usize = 10;
const PINNED_TODO_WINDOW_STACK_GAP: f64 = 28.0;
const PINNED_SUBTASKS_WINDOW_COLLAPSED_WIDTH: f64 = PINNED_TODO_WINDOW_COLLAPSED_WIDTH - 30.0;
const PINNED_SUBTASKS_WINDOW_EXPANDED_WIDTH: f64 = PINNED_TODO_WINDOW_EXPANDED_WIDTH - 40.0;
const PINNED_SUBTASKS_WINDOW_GAP: f64 = 4.0;
const PINNED_SUBTASKS_ITEM_COLLAPSED_HEIGHT: f64 = 46.0;
const PINNED_SUBTASKS_LIST_GAP: f64 = 8.0;
const PINNED_SUBTASKS_LIST_PADDING: f64 = 8.0;
const PINNED_SUBTASKS_MAX_COLLAPSED_ITEMS: usize = 3;
const PINNED_TODOS_UPDATED_EVENT: &str = "dotime-pinned-todos-updated";
const CLIPBOARD_POLL_INTERVAL_MS: u64 = 800;
const CLIPBOARD_MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;
const CLIPBOARD_HISTORY_LIMIT: usize = 100;
const CLIPBOARD_HISTORY_FILE: &str = "clipboard-history.json";
const TODO_IMAGES_DIR: &str = "todo-images";

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    utils::config::Color,
    Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder,
};

struct ReminderState(Mutex<Option<String>>);
struct ReminderScheduleState(Sender<Vec<ScheduledReminder>>);
struct MiniSubtasksState(Mutex<Option<String>>);
struct PinnedTodoState(Mutex<HashMap<String, String>>);
struct PinnedSubtasksState(Mutex<HashMap<String, String>>);
struct ClipboardMonitorState(Mutex<Option<mpsc::Sender<()>>>);
struct ClipboardHistoryState {
    items: Mutex<Vec<ClipboardSnapshot>>,
    suppressed_fingerprint: Mutex<Option<String>>,
    storage_path: Mutex<Option<PathBuf>>,
}

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TodoImageInput {
    id: String,
    name: String,
    mime_type: Option<String>,
    file_name: Option<String>,
    data_url: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredTodoImage {
    id: String,
    name: String,
    mime_type: Option<String>,
    file_name: String,
}

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TodoImageReference {
    todo_id: String,
    file_names: Vec<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TodoImageCleanupResult {
    removed_dirs: usize,
    removed_files: usize,
    failed_dirs: usize,
    failed_files: usize,
}

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledReminder {
    id: String,
    title: String,
    reminder_time: String,
    due_at: i64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipboardSnapshot {
    id: String,
    kind: String,
    captured_at: i64,
    text: Option<String>,
    image_data_url: Option<String>,
    image_width: Option<usize>,
    image_height: Option<usize>,
    byte_size: Option<usize>,
    pinned: bool,
    copy_count: u32,
    #[serde(skip_serializing)]
    image_dib: Option<Vec<u8>>,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredClipboardSnapshot {
    id: String,
    kind: String,
    captured_at: i64,
    text: Option<String>,
    image_data_url: Option<String>,
    image_width: Option<usize>,
    image_height: Option<usize>,
    byte_size: Option<usize>,
    pinned: bool,
    copy_count: u32,
    image_dib_base64: Option<String>,
}

#[tauri::command]
fn get_clipboard_history(
    state: State<'_, ClipboardHistoryState>,
) -> Result<Vec<ClipboardSnapshot>, String> {
    state
        .items
        .lock()
        .map(|items| sorted_clipboard_history(items.clone()))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_clipboard_history(state: State<'_, ClipboardHistoryState>) -> Result<(), String> {
    state
        .items
        .lock()
        .map_err(|error| error.to_string())?
        .clear();
    save_clipboard_history(&state)
}

#[tauri::command]
fn remove_clipboard_history_item(
    state: State<'_, ClipboardHistoryState>,
    id: String,
) -> Result<(), String> {
    state
        .items
        .lock()
        .map_err(|error| error.to_string())?
        .retain(|item| item.id != id);
    save_clipboard_history(&state)
}

#[tauri::command]
fn copy_clipboard_history_item(
    state: State<'_, ClipboardHistoryState>,
    id: String,
) -> Result<ClipboardSnapshot, String> {
    let mut items = state.items.lock().map_err(|error| error.to_string())?;
    let Some(index) = items.iter().position(|item| item.id == id) else {
        return Err("clipboard item not found".into());
    };

    let item = items[index].clone();
    write_clipboard_snapshot(&item)?;
    *state
        .suppressed_fingerprint
        .lock()
        .map_err(|error| error.to_string())? = Some(clipboard_fingerprint(&item));

    items[index].copy_count = items[index].copy_count.saturating_add(1);
    let updated = items[index].clone();
    drop(items);
    save_clipboard_history_async(&state);
    Ok(updated)
}

#[tauri::command]
fn toggle_clipboard_history_pin(
    state: State<'_, ClipboardHistoryState>,
    id: String,
) -> Result<Vec<ClipboardSnapshot>, String> {
    let mut items = state.items.lock().map_err(|error| error.to_string())?;
    let Some(item) = items.iter_mut().find(|item| item.id == id) else {
        return Err("clipboard item not found".into());
    };
    item.pinned = !item.pinned;
    let sorted = sorted_clipboard_history(items.clone());
    drop(items);
    save_clipboard_history(&state)?;
    Ok(sorted)
}

#[tauri::command]
fn persist_todo_images(
    app: tauri::AppHandle,
    todo_id: String,
    images: Vec<TodoImageInput>,
) -> Result<Vec<StoredTodoImage>, String> {
    let dir = todo_image_dir(&app, &todo_id)?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;

    let mut stored = Vec::with_capacity(images.len());
    let mut keep_files = std::collections::HashSet::new();

    for image in images {
        let mime_type = image
            .mime_type
            .clone()
            .or_else(|| data_url_mime_type(image.data_url.as_deref()));
        let file_name = if let Some(data_url) = image.data_url.as_deref() {
            let bytes = decode_data_url(data_url)?;
            let ext = mime_type_to_extension(mime_type.as_deref());
            let file_name = format!("{}.{}", sanitize_path_segment(&image.id, "image"), ext);
            fs::write(dir.join(&file_name), bytes).map_err(|error| error.to_string())?;
            file_name
        } else if let Some(file_name) = image.file_name.clone() {
            let file_name = sanitize_path_segment(&file_name, "image");
            let file_path = dir.join(&file_name);
            if !file_path.exists() {
                return Err(format!("todo image file missing: {}", file_name));
            }
            file_name
        } else {
            continue;
        };

        keep_files.insert(file_name.clone());
        stored.push(StoredTodoImage {
            id: image.id,
            name: image.name,
            mime_type,
            file_name,
        });
    }

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if !keep_files.contains(name) {
                let _ = fs::remove_file(path);
            }
        }
    }

    Ok(stored)
}

#[tauri::command]
fn remove_todo_images(app: tauri::AppHandle, todo_id: String) -> Result<(), String> {
    let dir = todo_image_dir(&app, &todo_id)?;
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn cleanup_todo_images(
    app: tauri::AppHandle,
    references: Vec<TodoImageReference>,
) -> Result<TodoImageCleanupResult, String> {
    let base_dir = todo_images_base_dir(&app)?;
    let mut keep_by_todo_id = std::collections::HashMap::new();
    for reference in references {
        let todo_id = sanitize_path_segment(&reference.todo_id, "todo");
        let file_names = reference
            .file_names
            .into_iter()
            .map(|file_name| sanitize_path_segment(&file_name, "image"))
            .collect::<std::collections::HashSet<_>>();
        keep_by_todo_id.insert(todo_id, file_names);
    }

    let mut removed_dirs = 0;
    let mut removed_files = 0;
    let mut failed_dirs = 0;
    let mut failed_files = 0;
    let entries = fs::read_dir(&base_dir).map_err(|error| error.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(todo_id) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let Some(keep_files) = keep_by_todo_id.get(todo_id) else {
            match fs::remove_dir_all(path) {
                Ok(()) => removed_dirs += 1,
                Err(_) => failed_dirs += 1,
            }
            continue;
        };

        if let Ok(files) = fs::read_dir(&path) {
            for file in files.flatten() {
                let file_path = file.path();
                if !file_path.is_file() {
                    continue;
                }
                let Some(file_name) = file_path.file_name().and_then(|value| value.to_str()) else {
                    continue;
                };
                if !keep_files.contains(file_name) {
                    match fs::remove_file(file_path) {
                        Ok(()) => removed_files += 1,
                        Err(_) => failed_files += 1,
                    }
                }
            }
        }
    }

    Ok(TodoImageCleanupResult {
        removed_dirs,
        removed_files,
        failed_dirs,
        failed_files,
    })
}

#[tauri::command]
fn set_window_opacity(window: tauri::Window, opacity: f64) -> Result<(), String> {
    set_native_window_opacity(window, opacity)
}

#[tauri::command]
fn set_pinned_window_frame(
    window: tauri::Window,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    set_native_window_frame(&window, x, y, width, height)
}

#[tauri::command]
fn bring_pinned_stack_to_front(app: tauri::AppHandle, slot: String) -> Result<(), String> {
    let index = slot.parse::<usize>().unwrap_or(0);
    if let Some(window) = app.get_webview_window(&pinned_todo_window_label(index)) {
        bring_native_window_to_front(&window)?;
    }
    if let Some(window) = app.get_webview_window(&pinned_subtasks_window_label(index)) {
        bring_native_window_to_front(&window)?;
    }
    Ok(())
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
fn close_clipboard_window(app: tauri::AppHandle, window: tauri::Window) -> Result<(), String> {
    stop_clipboard_monitor(&app);
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
fn close_mini_subtasks_window(
    app: tauri::AppHandle,
    state: State<'_, MiniSubtasksState>,
) -> Result<(), String> {
    *state.0.lock().map_err(|error| error.to_string())? = None;
    hide_mini_subtasks_windows(&app);
    let _ = app.emit("dotime-mini-subtasks-closed", serde_json::json!({}));
    Ok(())
}

#[tauri::command]
fn show_clipboard_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = match app.get_webview_window("clipboard") {
        Some(window) => window,
        None => WebviewWindowBuilder::new(
            &app,
            "clipboard",
            WebviewUrl::App("index.html?view=clipboard".into()),
        )
        .title("doTime 剪贴板")
        .visible(false)
        .decorations(false)
        .transparent(false)
        .resizable(true)
        .inner_size(508.0, 620.0)
        .min_inner_size(508.0, 420.0)
        .build()
        .map_err(|error| error.to_string())?,
    };

    let _ = window.unminimize();
    let _ = window.center();
    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    start_clipboard_monitor(&app);
    Ok(())
}

#[tauri::command]
fn show_mini_subtasks_window(
    app: tauri::AppHandle,
    state: State<'_, MiniSubtasksState>,
    subtasks_group: String,
) -> Result<(), String> {
    *state.0.lock().map_err(|error| error.to_string())? = Some(subtasks_group.clone());
    show_mini_subtasks_window_inner(&app, subtasks_group)
}

#[tauri::command]
fn show_pinned_todo_window(
    app: tauri::AppHandle,
    state: State<'_, PinnedTodoState>,
    pinned_todo: String,
) -> Result<String, String> {
    let todo: serde_json::Value =
        serde_json::from_str(&pinned_todo).map_err(|error| error.to_string())?;
    let todo_id = todo
        .get("id")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "missing pinned todo id".to_string())?;
    let slot = {
        let pinned = state.0.lock().map_err(|error| error.to_string())?;
        find_pinned_todo_slot(&pinned, todo_id)
            .or_else(|| first_available_pinned_todo_slot(&pinned))
            .ok_or_else(|| "固定待办窗口已达到上限".to_string())?
    };
    let window_label = pinned_todo_window_label(slot);

    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .insert(slot.to_string(), pinned_todo.clone());

    let window = match app.get_webview_window(&window_label) {
        Some(window) => window,
        None => {
            eprintln!("pinned todo window {window_label} was not pre-registered; building it");
            WebviewWindowBuilder::new(
                &app,
                &window_label,
                WebviewUrl::App(format!("index.html?view=pinned-todo&slot={slot}").into()),
            )
            .visible(false)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .background_color(Color(0, 0, 0, 0))
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .inner_size(
                PINNED_TODO_WINDOW_COLLAPSED_WIDTH,
                PINNED_TODO_WINDOW_COLLAPSED_HEIGHT,
            )
            .build()
            .map_err(|error| error.to_string())?
        }
    };

    let _ = window.unminimize();
    let _ = window.set_always_on_top(true);
    let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
    let pinned = state.0.lock().map_err(|error| error.to_string())?;
    position_pinned_todo_window(&window, slot, &pinned);
    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    let _ = window.emit(format!("dotime-pinned-todo-{slot}").as_str(), pinned_todo);
    let _ = app.emit(PINNED_TODOS_UPDATED_EVENT, ());
    Ok(slot.to_string())
}

#[tauri::command]
fn get_active_pinned_todo(
    state: State<'_, PinnedTodoState>,
    slot: String,
) -> Result<Option<String>, String> {
    state
        .0
        .lock()
        .map(|todos| todos.get(&slot).cloned())
        .map_err(|error| error.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivePinnedTodo {
    slot: String,
    todo_id: String,
}

#[tauri::command]
fn get_active_pinned_todos(
    state: State<'_, PinnedTodoState>,
) -> Result<Vec<ActivePinnedTodo>, String> {
    let pinned = state.0.lock().map_err(|error| error.to_string())?;
    let mut active = Vec::with_capacity(pinned.len());

    for (slot, todo) in pinned.iter() {
        let parsed =
            serde_json::from_str::<serde_json::Value>(todo).map_err(|error| error.to_string())?;
        let Some(todo_id) = parsed.get("id").and_then(|value| value.as_str()) else {
            continue;
        };
        active.push(ActivePinnedTodo {
            slot: slot.clone(),
            todo_id: todo_id.to_string(),
        });
    }

    Ok(active)
}

#[tauri::command]
fn remove_pinned_todo(
    app: tauri::AppHandle,
    state: State<'_, PinnedTodoState>,
    subtasks_state: State<'_, PinnedSubtasksState>,
    slot: String,
) -> Result<(), String> {
    let window_label = pinned_todo_window_label(slot.parse::<usize>().unwrap_or(0));
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&slot);
    if let Some(window) = app.get_webview_window(&window_label) {
        window.hide().map_err(|error| error.to_string())?;
    }
    close_pinned_subtasks_window(app.clone(), subtasks_state, slot)?;
    let _ = app.emit(PINNED_TODOS_UPDATED_EVENT, ());
    Ok(())
}

#[tauri::command]
fn get_active_pinned_subtasks_group(
    state: State<'_, PinnedSubtasksState>,
    slot: String,
) -> Result<Option<String>, String> {
    state
        .0
        .lock()
        .map(|groups| groups.get(&slot).cloned())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn show_pinned_subtasks_window(
    app: tauri::AppHandle,
    state: State<'_, PinnedSubtasksState>,
    pinned_todo_state: State<'_, PinnedTodoState>,
    slot: String,
    subtasks_group: String,
) -> Result<(), String> {
    let item_count = mini_subtasks_item_count(&subtasks_group);
    if item_count == 0 {
        return close_pinned_subtasks_window(app, state, slot);
    }

    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .insert(slot.clone(), subtasks_group.clone());

    let window_label = pinned_subtasks_window_label(slot.parse::<usize>().unwrap_or(0));
    let window = match app.get_webview_window(&window_label) {
        Some(window) => window,
        None => {
            eprintln!("pinned subtasks window {window_label} was not pre-registered; building it");
            let (sender, receiver) =
                std::sync::mpsc::channel::<Result<tauri::WebviewWindow, String>>();
            let app_handle = app.clone();
            let window_label_for_build = window_label.clone();
            let window_url =
                WebviewUrl::App(format!("index.html?view=pinned-subtasks&slot={slot}").into());
            let inner_height = pinned_subtasks_collapsed_height(item_count);
            app.run_on_main_thread(move || {
                let result =
                    WebviewWindowBuilder::new(&app_handle, &window_label_for_build, window_url)
                        .visible(false)
                        .decorations(false)
                        .transparent(true)
                        .always_on_top(true)
                        .skip_taskbar(true)
                        .resizable(false)
                        .inner_size(PINNED_SUBTASKS_WINDOW_COLLAPSED_WIDTH, inner_height)
                        .build()
                        .map_err(|error| error.to_string());
                let _ = sender.send(result);
            })
            .map_err(|error| error.to_string())?;
            receiver
                .recv()
                .map_err(|error| error.to_string())?
                .map_err(|error| error.to_string())?
        }
    };

    let target_height = pinned_subtasks_collapsed_height(item_count);
    let pinned = pinned_todo_state
        .0
        .lock()
        .map_err(|error| error.to_string())?;
    position_pinned_subtasks_window(
        &window,
        slot.parse::<usize>().unwrap_or(0),
        false,
        target_height,
        &pinned,
    );
    let _ = window.unminimize();
    let _ = window.set_always_on_top(true);
    window.show().map_err(|error| error.to_string())?;
    let _ = window.emit(
        format!("dotime-pinned-subtasks-{slot}").as_str(),
        subtasks_group,
    );
    Ok(())
}

#[tauri::command]
fn close_pinned_subtasks_window(
    app: tauri::AppHandle,
    state: State<'_, PinnedSubtasksState>,
    slot: String,
) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&slot);
    let window_label = pinned_subtasks_window_label(slot.parse::<usize>().unwrap_or(0));
    if let Some(window) = app.get_webview_window(&window_label) {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn sync_pinned_subtasks_window(
    app: tauri::AppHandle,
    state: State<'_, PinnedSubtasksState>,
    slot: String,
    subtasks_group: Option<String>,
) -> Result<(), String> {
    if let Some(subtasks_group) = subtasks_group {
        if mini_subtasks_item_count(&subtasks_group) == 0 {
            return close_pinned_subtasks_window(app, state, slot);
        }
        state
            .0
            .lock()
            .map_err(|error| error.to_string())?
            .insert(slot.clone(), subtasks_group);
    }
    Ok(())
}

fn pinned_todo_window_label(slot: usize) -> String {
    format!("pinned-todo-{slot}")
}

fn pinned_subtasks_window_label(slot: usize) -> String {
    format!("pinned-subtasks-{slot}")
}

fn find_pinned_todo_slot(pinned: &HashMap<String, String>, todo_id: &str) -> Option<usize> {
    pinned.iter().find_map(|(slot, todo)| {
        let parsed = serde_json::from_str::<serde_json::Value>(todo).ok()?;
        let pinned_id = parsed.get("id").and_then(|value| value.as_str())?;
        if pinned_id == todo_id {
            slot.parse::<usize>().ok()
        } else {
            None
        }
    })
}

fn first_available_pinned_todo_slot(pinned: &HashMap<String, String>) -> Option<usize> {
    (0..PINNED_TODO_WINDOW_COUNT).find(|slot| !pinned.contains_key(&slot.to_string()))
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http and https urls can be opened".into());
    }

    #[cfg(windows)]
    let result = Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn();

    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&url).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(&url).spawn();

    result.map(|_| ()).map_err(|error| error.to_string())
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
    let _ = window.set_focus();
    let _ = window.emit("dotime-reminder-group", reminder_group);
    Ok(())
}

fn show_mini_subtasks_window_inner(
    app: &tauri::AppHandle,
    subtasks_group: String,
) -> Result<(), String> {
    let item_count = mini_subtasks_item_count(&subtasks_group);
    if item_count == 0 {
        hide_mini_subtasks_windows(app);
        return Ok(());
    }

    let window = match app.get_webview_window("mini-subtasks") {
        Some(window) => window,
        None => WebviewWindowBuilder::new(
            app,
            "mini-subtasks",
            WebviewUrl::App("index.html?view=mini-subtasks".into()),
        )
        .title("doTime 子待办")
        .visible(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .inner_size(
            MINI_SUBTASKS_WINDOW_WIDTH,
            mini_subtasks_window_height(item_count),
        )
        .build()
        .map_err(|error| error.to_string())?,
    };

    position_mini_subtasks_window(&window, item_count);

    let _ = window.unminimize();
    let _ = window.set_always_on_top(true);
    window.show().map_err(|error| error.to_string())?;
    let _ = window.set_focus();
    let _ = window.emit("dotime-mini-subtasks-group", subtasks_group);

    hide_extra_mini_subtasks_windows(app, 1);
    Ok(())
}

fn todo_images_base_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join(TODO_IMAGES_DIR);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn todo_image_dir(app: &tauri::AppHandle, todo_id: &str) -> Result<PathBuf, String> {
    Ok(todo_images_base_dir(app)?.join(sanitize_path_segment(todo_id, "todo")))
}

fn sanitize_path_segment(value: &str, fallback: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    let trimmed = sanitized.trim_matches('.');
    if trimmed.is_empty() {
        fallback.into()
    } else {
        trimmed.into()
    }
}

fn decode_data_url(value: &str) -> Result<Vec<u8>, String> {
    let Some((prefix, payload)) = value.split_once(',') else {
        return Err("invalid data url".into());
    };
    if !prefix.starts_with("data:") {
        return Err("invalid data url".into());
    }
    let Some(base64_payload) = prefix
        .split_once(';')
        .map(|(_, _)| payload)
        .or(Some(payload))
    else {
        return Err("invalid data url".into());
    };
    decode_base64(base64_payload).ok_or_else(|| "invalid image data".into())
}

fn data_url_mime_type(value: Option<&str>) -> Option<String> {
    let value = value?;
    let prefix = value.split_once(',')?.0;
    let mime = prefix.strip_prefix("data:")?.split_once(';')?.0;
    if mime.is_empty() {
        None
    } else {
        Some(mime.to_string())
    }
}

fn mime_type_to_extension(mime_type: Option<&str>) -> &str {
    match mime_type {
        Some("image/jpeg") => "jpg",
        Some("image/jpg") => "jpg",
        Some("image/png") => "png",
        Some("image/webp") => "webp",
        Some("image/gif") => "gif",
        Some("image/bmp") => "bmp",
        Some("image/svg+xml") => "svg",
        _ => "png",
    }
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
fn get_active_mini_subtasks_group(
    state: State<'_, MiniSubtasksState>,
) -> Result<Option<String>, String> {
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

fn run_clipboard_monitor(app: tauri::AppHandle, receiver: Receiver<()>) {
    let mut last_fingerprint = String::new();

    loop {
        match receiver.recv_timeout(Duration::from_millis(CLIPBOARD_POLL_INTERVAL_MS)) {
            Ok(()) | Err(RecvTimeoutError::Disconnected) => return,
            Err(RecvTimeoutError::Timeout) => {}
        }

        if let Some(snapshot) = read_clipboard_snapshot() {
            let fingerprint = clipboard_fingerprint(&snapshot);
            if let Some(state) = app.try_state::<ClipboardHistoryState>() {
                let suppressed = state
                    .suppressed_fingerprint
                    .lock()
                    .ok()
                    .and_then(|mut value| value.take());
                if suppressed.as_deref() == Some(&fingerprint) {
                    continue;
                }
            }

            if fingerprint != last_fingerprint {
                last_fingerprint = fingerprint.clone();
                let mut outgoing_snapshot = snapshot.clone();
                if let Some(state) = app.try_state::<ClipboardHistoryState>() {
                    if let Ok(mut history) = state.items.lock() {
                        let mut existing = history
                            .iter()
                            .find(|item| clipboard_fingerprint(item) == fingerprint)
                            .cloned()
                            .unwrap_or_else(|| snapshot.clone());
                        existing.captured_at = snapshot.captured_at;
                        existing.text = snapshot.text.clone();
                        existing.image_data_url = snapshot.image_data_url.clone();
                        existing.image_width = snapshot.image_width;
                        existing.image_height = snapshot.image_height;
                        existing.byte_size = snapshot.byte_size;
                        existing.image_dib = snapshot.image_dib.clone();
                        outgoing_snapshot = existing.clone();

                        history.retain(|item| clipboard_fingerprint(item) != fingerprint);
                        history.insert(0, existing);
                        history.truncate(CLIPBOARD_HISTORY_LIMIT);
                    }
                    save_clipboard_history_async(&state);
                }
                let _ = app.emit("dotime-clipboard-changed", outgoing_snapshot);
            }
        }
    }
}

fn start_clipboard_monitor(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<ClipboardMonitorState>() else {
        return;
    };
    let Ok(mut guard) = state.0.lock() else {
        return;
    };
    if guard.is_some() {
        return;
    }

    let (sender, receiver) = mpsc::channel();
    let app_handle = app.clone();
    thread::spawn(move || run_clipboard_monitor(app_handle, receiver));
    *guard = Some(sender);
}

fn stop_clipboard_monitor(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<ClipboardMonitorState>() else {
        return;
    };
    let Ok(mut guard) = state.0.lock() else {
        return;
    };
    if let Some(sender) = guard.take() {
        let _ = sender.send(());
    }
}

fn clipboard_fingerprint(snapshot: &ClipboardSnapshot) -> String {
    match (&snapshot.text, &snapshot.image_data_url) {
        (Some(text), _) => format!("text:{}", text),
        (_, Some(image_data_url)) => format!(
            "image:{}:{}:{}",
            snapshot.image_width.unwrap_or_default(),
            snapshot.image_height.unwrap_or_default(),
            image_data_url.len()
        ),
        _ => format!(
            "{}:{}:{}",
            snapshot.kind,
            snapshot.image_width.unwrap_or_default(),
            snapshot.byte_size.unwrap_or_default()
        ),
    }
}

fn sorted_clipboard_history(mut items: Vec<ClipboardSnapshot>) -> Vec<ClipboardSnapshot> {
    items.sort_by(|left, right| {
        right
            .pinned
            .cmp(&left.pinned)
            .then_with(|| right.copy_count.cmp(&left.copy_count))
            .then_with(|| right.captured_at.cmp(&left.captured_at))
    });
    items
}

fn clipboard_history_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(CLIPBOARD_HISTORY_FILE))
}

fn load_clipboard_history_from_path(path: &PathBuf) -> Vec<ClipboardSnapshot> {
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(stored_items) = serde_json::from_str::<Vec<StoredClipboardSnapshot>>(&content) else {
        return Vec::new();
    };

    sorted_clipboard_history(
        stored_items
            .into_iter()
            .take(CLIPBOARD_HISTORY_LIMIT)
            .map(stored_clipboard_snapshot_to_runtime)
            .collect(),
    )
}

fn save_clipboard_history(state: &ClipboardHistoryState) -> Result<(), String> {
    let path = clipboard_storage_path(state)?;
    let Some(path) = path else {
        return Ok(());
    };

    let items = state
        .items
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    write_clipboard_history_to_path(path, items)
}

fn save_clipboard_history_async(state: &ClipboardHistoryState) {
    let path = match clipboard_storage_path(state) {
        Ok(path) => path,
        Err(error) => {
            eprintln!("failed to resolve clipboard history path: {error}");
            return;
        }
    };
    let Some(path) = path else {
        return;
    };

    let items = match state.items.lock() {
        Ok(items) => items.clone(),
        Err(error) => {
            eprintln!("failed to read clipboard history: {error}");
            return;
        }
    };

    thread::spawn(move || {
        if let Err(error) = write_clipboard_history_to_path(path, items) {
            eprintln!("failed to save clipboard history: {error}");
        }
    });
}

fn clipboard_storage_path(state: &ClipboardHistoryState) -> Result<Option<PathBuf>, String> {
    state
        .storage_path
        .lock()
        .map(|path| path.clone())
        .map_err(|error| error.to_string())
}

fn write_clipboard_history_to_path(
    path: PathBuf,
    items: Vec<ClipboardSnapshot>,
) -> Result<(), String> {
    let stored_items = sorted_clipboard_history(items)
        .into_iter()
        .take(CLIPBOARD_HISTORY_LIMIT)
        .map(runtime_clipboard_snapshot_to_stored)
        .collect::<Vec<_>>();
    let content = serde_json::to_string(&stored_items).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn runtime_clipboard_snapshot_to_stored(item: ClipboardSnapshot) -> StoredClipboardSnapshot {
    StoredClipboardSnapshot {
        id: item.id,
        kind: item.kind,
        captured_at: item.captured_at,
        text: item.text,
        image_data_url: item.image_data_url,
        image_width: item.image_width,
        image_height: item.image_height,
        byte_size: item.byte_size,
        pinned: item.pinned,
        copy_count: item.copy_count,
        image_dib_base64: item.image_dib.map(|dib| encode_base64(&dib)),
    }
}

fn stored_clipboard_snapshot_to_runtime(item: StoredClipboardSnapshot) -> ClipboardSnapshot {
    ClipboardSnapshot {
        id: item.id,
        kind: item.kind,
        captured_at: item.captured_at,
        text: item.text,
        image_data_url: item.image_data_url,
        image_width: item.image_width,
        image_height: item.image_height,
        byte_size: item.byte_size,
        pinned: item.pinned,
        copy_count: item.copy_count,
        image_dib: item.image_dib_base64.as_deref().and_then(decode_base64),
    }
}

fn format_byte_size(bytes: usize) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / 1024.0 / 1024.0)
    } else if bytes >= 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{bytes} B")
    }
}

#[cfg(windows)]
fn write_clipboard_snapshot(snapshot: &ClipboardSnapshot) -> Result<(), String> {
    write_windows_clipboard_snapshot(snapshot)
}

#[cfg(not(windows))]
fn write_clipboard_snapshot(_snapshot: &ClipboardSnapshot) -> Result<(), String> {
    Err("system clipboard writing is only supported on Windows".into())
}

#[cfg(windows)]
fn read_clipboard_snapshot() -> Option<ClipboardSnapshot> {
    read_windows_clipboard_snapshot()
}

#[cfg(not(windows))]
fn read_clipboard_snapshot() -> Option<ClipboardSnapshot> {
    None
}

#[cfg(windows)]
fn read_windows_clipboard_snapshot() -> Option<ClipboardSnapshot> {
    use std::ffi::c_void;
    use std::ptr::null_mut;

    type Hwnd = *mut c_void;
    type Handle = *mut c_void;

    const CF_UNICODETEXT: u32 = 13;
    const CF_DIB: u32 = 8;
    const BI_BITFIELDS: u32 = 3;

    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(hwnd: Hwnd) -> i32;
        fn CloseClipboard() -> i32;
        fn IsClipboardFormatAvailable(format: u32) -> i32;
        fn GetClipboardData(format: u32) -> Handle;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalLock(handle: Handle) -> *mut c_void;
        fn GlobalUnlock(handle: Handle) -> i32;
        fn GlobalSize(handle: Handle) -> usize;
    }

    unsafe {
        if OpenClipboard(null_mut()) == 0 {
            return None;
        }

        let snapshot = if IsClipboardFormatAvailable(CF_UNICODETEXT) != 0 {
            read_windows_clipboard_text(GetClipboardData(CF_UNICODETEXT), GlobalLock, GlobalUnlock)
        } else if IsClipboardFormatAvailable(CF_DIB) != 0 {
            read_windows_clipboard_dib(
                GetClipboardData(CF_DIB),
                GlobalLock,
                GlobalUnlock,
                GlobalSize,
                BI_BITFIELDS,
            )
        } else {
            None
        };

        CloseClipboard();
        snapshot
    }
}

#[cfg(windows)]
fn write_windows_clipboard_snapshot(snapshot: &ClipboardSnapshot) -> Result<(), String> {
    use std::ffi::c_void;
    use std::ptr::null_mut;

    type Hwnd = *mut c_void;
    type Handle = *mut c_void;

    const CF_UNICODETEXT: u32 = 13;
    const CF_DIB: u32 = 8;
    const GMEM_MOVEABLE: u32 = 0x0002;

    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(hwnd: Hwnd) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(format: u32, mem: Handle) -> Handle;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalAlloc(flags: u32, bytes: usize) -> Handle;
        fn GlobalLock(handle: Handle) -> *mut c_void;
        fn GlobalUnlock(handle: Handle) -> i32;
    }

    if snapshot.kind == "image" && snapshot.image_dib.is_none() {
        return Err("这条图片记录缺少可复制的图片数据，请重新复制原图一次。".into());
    }
    if snapshot.kind != "image" && snapshot.text.is_none() {
        return Err("这条剪贴板记录没有可复制的内容。".into());
    }

    unsafe {
        if OpenClipboard(null_mut()) == 0 {
            return Err("failed to open clipboard".into());
        }

        if EmptyClipboard() == 0 {
            CloseClipboard();
            return Err("failed to empty clipboard".into());
        }

        let result = if snapshot.kind == "image" {
            if let Some(dib) = &snapshot.image_dib {
                write_windows_clipboard_dib(
                    dib,
                    GlobalAlloc,
                    GlobalLock,
                    GlobalUnlock,
                    SetClipboardData,
                    GMEM_MOVEABLE,
                    CF_DIB,
                )
            } else {
                Err("clipboard image item has no image data".into())
            }
        } else if let Some(text) = &snapshot.text {
            write_windows_clipboard_text(
                text,
                GlobalAlloc,
                GlobalLock,
                GlobalUnlock,
                SetClipboardData,
                GMEM_MOVEABLE,
                CF_UNICODETEXT,
            )
        } else {
            Err("clipboard item has no copyable content".into())
        };

        CloseClipboard();
        result
    }
}

#[cfg(windows)]
unsafe fn write_windows_clipboard_text(
    text: &str,
    global_alloc: unsafe extern "system" fn(u32, usize) -> *mut std::ffi::c_void,
    global_lock: unsafe extern "system" fn(*mut std::ffi::c_void) -> *mut std::ffi::c_void,
    global_unlock: unsafe extern "system" fn(*mut std::ffi::c_void) -> i32,
    set_clipboard_data: unsafe extern "system" fn(
        u32,
        *mut std::ffi::c_void,
    ) -> *mut std::ffi::c_void,
    flags: u32,
    format: u32,
) -> Result<(), String> {
    let mut utf16 = text.encode_utf16().collect::<Vec<_>>();
    utf16.push(0);
    let byte_len = utf16.len() * std::mem::size_of::<u16>();
    let handle = copy_bytes_to_global(
        utf16.as_ptr() as *const u8,
        byte_len,
        global_alloc,
        global_lock,
        global_unlock,
        flags,
    )?;
    if set_clipboard_data(format, handle).is_null() {
        Err("failed to set clipboard text".into())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
unsafe fn write_windows_clipboard_dib(
    dib: &[u8],
    global_alloc: unsafe extern "system" fn(u32, usize) -> *mut std::ffi::c_void,
    global_lock: unsafe extern "system" fn(*mut std::ffi::c_void) -> *mut std::ffi::c_void,
    global_unlock: unsafe extern "system" fn(*mut std::ffi::c_void) -> i32,
    set_clipboard_data: unsafe extern "system" fn(
        u32,
        *mut std::ffi::c_void,
    ) -> *mut std::ffi::c_void,
    flags: u32,
    format: u32,
) -> Result<(), String> {
    let handle = copy_bytes_to_global(
        dib.as_ptr(),
        dib.len(),
        global_alloc,
        global_lock,
        global_unlock,
        flags,
    )?;
    if set_clipboard_data(format, handle).is_null() {
        Err("failed to set clipboard image".into())
    } else {
        Ok(())
    }
}

#[cfg(windows)]
unsafe fn copy_bytes_to_global(
    source: *const u8,
    byte_len: usize,
    global_alloc: unsafe extern "system" fn(u32, usize) -> *mut std::ffi::c_void,
    global_lock: unsafe extern "system" fn(*mut std::ffi::c_void) -> *mut std::ffi::c_void,
    global_unlock: unsafe extern "system" fn(*mut std::ffi::c_void) -> i32,
    flags: u32,
) -> Result<*mut std::ffi::c_void, String> {
    let handle = global_alloc(flags, byte_len);
    if handle.is_null() {
        return Err("failed to allocate clipboard memory".into());
    }

    let target = global_lock(handle) as *mut u8;
    if target.is_null() {
        return Err("failed to lock clipboard memory".into());
    }

    std::ptr::copy_nonoverlapping(source, target, byte_len);
    global_unlock(handle);
    Ok(handle)
}

#[cfg(windows)]
unsafe fn read_windows_clipboard_text(
    handle: *mut std::ffi::c_void,
    global_lock: unsafe extern "system" fn(*mut std::ffi::c_void) -> *mut std::ffi::c_void,
    global_unlock: unsafe extern "system" fn(*mut std::ffi::c_void) -> i32,
) -> Option<ClipboardSnapshot> {
    if handle.is_null() {
        return None;
    }

    let locked = global_lock(handle) as *const u16;
    if locked.is_null() {
        return None;
    }

    let mut len = 0usize;
    while *locked.add(len) != 0 {
        len += 1;
    }

    let text = String::from_utf16_lossy(std::slice::from_raw_parts(locked, len));
    global_unlock(handle);
    if text.is_empty() {
        return None;
    }

    let now = current_timestamp_millis();
    Some(ClipboardSnapshot {
        id: format!("clip-text-{now}"),
        kind: "text".into(),
        captured_at: now,
        byte_size: Some(text.len()),
        text: Some(text),
        image_data_url: None,
        image_width: None,
        image_height: None,
        pinned: false,
        copy_count: 0,
        image_dib: None,
    })
}

#[cfg(windows)]
unsafe fn read_windows_clipboard_dib(
    handle: *mut std::ffi::c_void,
    global_lock: unsafe extern "system" fn(*mut std::ffi::c_void) -> *mut std::ffi::c_void,
    global_unlock: unsafe extern "system" fn(*mut std::ffi::c_void) -> i32,
    global_size: unsafe extern "system" fn(*mut std::ffi::c_void) -> usize,
    bi_bitfields: u32,
) -> Option<ClipboardSnapshot> {
    if handle.is_null() {
        return None;
    }

    let size = global_size(handle);
    if size < 40 {
        return None;
    }

    let locked = global_lock(handle) as *const u8;
    if locked.is_null() {
        return None;
    }

    let dib = std::slice::from_raw_parts(locked, size);
    let width = read_i32_le(dib, 4).unsigned_abs() as usize;
    let height = read_i32_le(dib, 8).unsigned_abs() as usize;
    let image = build_bmp_data_url(dib, bi_bitfields);
    global_unlock(handle);

    let now = current_timestamp_millis();
    if size > CLIPBOARD_MAX_IMAGE_BYTES {
        return Some(ClipboardSnapshot {
            id: format!("clip-image-large-{now}"),
            kind: "image".into(),
            captured_at: now,
            text: Some(format!(
                "图片过大，已跳过预览（{} x {}，{}）",
                width,
                height,
                format_byte_size(size)
            )),
            image_data_url: None,
            image_width: Some(width),
            image_height: Some(height),
            byte_size: Some(size),
            pinned: false,
            copy_count: 0,
            image_dib: Some(dib.to_vec()),
        });
    }

    Some(ClipboardSnapshot {
        id: format!("clip-image-{now}"),
        kind: "image".into(),
        captured_at: now,
        text: None,
        image_data_url: image,
        image_width: Some(width),
        image_height: Some(height),
        byte_size: Some(size),
        pinned: false,
        copy_count: 0,
        image_dib: Some(dib.to_vec()),
    })
}

#[cfg(windows)]
fn build_bmp_data_url(dib: &[u8], bi_bitfields: u32) -> Option<String> {
    if dib.len() < 40 {
        return None;
    }

    let header_size = read_u32_le(dib, 0) as usize;
    let bit_count = read_u16_le(dib, 14);
    let compression = read_u32_le(dib, 16);
    let clr_used = read_u32_le(dib, 32) as usize;
    let palette_colors = if clr_used > 0 {
        clr_used
    } else if bit_count <= 8 {
        1usize << bit_count
    } else {
        0
    };
    let bitfield_bytes = if compression == bi_bitfields && header_size == 40 {
        12
    } else {
        0
    };
    let pixel_offset = 14 + header_size + bitfield_bytes + palette_colors * 4;
    let file_size = 14 + dib.len();

    let mut bmp = Vec::with_capacity(file_size);
    bmp.extend_from_slice(b"BM");
    bmp.extend_from_slice(&(file_size as u32).to_le_bytes());
    bmp.extend_from_slice(&[0, 0, 0, 0]);
    bmp.extend_from_slice(&(pixel_offset as u32).to_le_bytes());
    bmp.extend_from_slice(dib);

    Some(format!("data:image/bmp;base64,{}", encode_base64(&bmp)))
}

#[cfg(windows)]
fn read_u16_le(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

#[cfg(windows)]
fn read_u32_le(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

#[cfg(windows)]
fn read_i32_le(bytes: &[u8], offset: usize) -> i32 {
    i32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);

        output.push(TABLE[(b0 >> 2) as usize] as char);
        output.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            output.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            output.push('=');
        }
        if chunk.len() > 2 {
            output.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        } else {
            output.push('=');
        }
    }

    output
}

fn decode_base64(value: &str) -> Option<Vec<u8>> {
    fn decode_char(byte: u8) -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let bytes = value.as_bytes();
    if !bytes.len().is_multiple_of(4) {
        return None;
    }

    let mut output = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let first = decode_char(chunk[0])?;
        let second = decode_char(chunk[1])?;
        let third = if chunk[2] == b'=' {
            0
        } else {
            decode_char(chunk[2])?
        };
        let fourth = if chunk[3] == b'=' {
            0
        } else {
            decode_char(chunk[3])?
        };

        output.push((first << 2) | (second >> 4));
        if chunk[2] != b'=' {
            output.push((second << 4) | (third >> 2));
        }
        if chunk[3] != b'=' {
            output.push((third << 6) | fourth);
        }
    }

    Some(output)
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

fn mini_subtasks_item_count(subtasks_group: &str) -> usize {
    serde_json::from_str::<serde_json::Value>(subtasks_group)
        .ok()
        .and_then(|value| {
            value
                .get("items")
                .and_then(|items| items.as_array().cloned())
        })
        .map(|items| items.len())
        .unwrap_or(0)
}

fn mini_subtasks_window_height(item_count: usize) -> f64 {
    (item_count as f64 * MINI_SUBTASKS_WINDOW_ROW_HEIGHT + MINI_SUBTASKS_WINDOW_VERTICAL_CHROME)
        .clamp(MINI_SUBTASKS_WINDOW_HEIGHT, MINI_SUBTASKS_WINDOW_MAX_HEIGHT)
}

fn pinned_subtasks_collapsed_height(item_count: usize) -> f64 {
    let shown = item_count.min(PINNED_SUBTASKS_MAX_COLLAPSED_ITEMS);
    shown as f64 * PINNED_SUBTASKS_ITEM_COLLAPSED_HEIGHT
        + shown.saturating_sub(1) as f64 * PINNED_SUBTASKS_LIST_GAP
        + PINNED_SUBTASKS_LIST_PADDING
}

fn pinned_todo_slot_footprint(payload: &serde_json::Value) -> f64 {
    let subtask_total = payload
        .get("subtaskTotal")
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as usize;
    if subtask_total == 0 {
        PINNED_TODO_WINDOW_COLLAPSED_HEIGHT + PINNED_TODO_WINDOW_STACK_GAP
    } else {
        PINNED_TODO_WINDOW_COLLAPSED_HEIGHT
            + PINNED_SUBTASKS_WINDOW_GAP
            + pinned_subtasks_collapsed_height(subtask_total)
            + PINNED_SUBTASKS_WINDOW_GAP
    }
}

fn pinned_todo_slot_y(pinned: &HashMap<String, String>, index: usize, margin: f64) -> f64 {
    let mut y = margin;
    for i in 0..index {
        let footprint = pinned
            .get(&i.to_string())
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .map(|payload| pinned_todo_slot_footprint(&payload))
            .unwrap_or(PINNED_TODO_WINDOW_COLLAPSED_HEIGHT + PINNED_TODO_WINDOW_STACK_GAP);
        y += footprint;
    }
    y
}

fn position_pinned_todo_window(
    window: &tauri::WebviewWindow,
    index: usize,
    pinned: &HashMap<String, String>,
) {
    let main_window = window.app_handle().get_webview_window("main");
    let scale_factor = main_window
        .as_ref()
        .and_then(|main| main.scale_factor().ok())
        .unwrap_or_else(|| window.scale_factor().unwrap_or(1.0));
    let window_width = PINNED_TODO_WINDOW_COLLAPSED_WIDTH * scale_factor;
    let window_height = PINNED_TODO_WINDOW_COLLAPSED_HEIGHT * scale_factor;
    let margin = PINNED_TODO_WINDOW_MARGIN * scale_factor;
    let monitor = main_window
        .as_ref()
        .and_then(|main| main.current_monitor().ok().flatten())
        .or_else(|| {
            main_window
                .as_ref()
                .and_then(|main| main.primary_monitor().ok().flatten())
        })
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let work_area = monitor.work_area();
        let x = work_area.position.x as f64 + work_area.size.width as f64 - window_width;
        let min_y = work_area.position.y as f64 + margin;
        let max_y =
            work_area.position.y as f64 + work_area.size.height as f64 - window_height - margin;
        let y = (work_area.position.y as f64
            + pinned_todo_slot_y(pinned, index, PINNED_TODO_WINDOW_MARGIN) * scale_factor)
            .clamp(min_y, max_y.max(min_y));
        let _ = window.set_position(PhysicalPosition::new(x, y));
        let _ = window.set_size(PhysicalSize::new(window_width, window_height));
    } else {
        let _ = window.set_size(PhysicalSize::new(window_width, window_height));
    }
}

fn position_pinned_subtasks_window(
    window: &tauri::WebviewWindow,
    index: usize,
    expanded: bool,
    target_height: f64,
    pinned: &HashMap<String, String>,
) {
    // 参照迷你模式的父子窗口处理：子待办窗口显示在父固定窗口正下方，宽度小于父窗口
    // 展开/收起状态由父固定窗口广播，子窗口跟随父窗口同步
    // 悬停父或子任一窗口都会展开，移开一起收起
    // 窗口尺寸/位置过渡动画由前端逐帧驱动
    // 子窗口右对齐屏幕边缘，展开高度按子待办条数自适应
    // 收起高度需要容纳第一条子待办的完整内容，避免底部被截断
    let main_window = window.app_handle().get_webview_window("main");
    let scale_factor = main_window
        .as_ref()
        .and_then(|main| main.scale_factor().ok())
        .unwrap_or_else(|| window.scale_factor().unwrap_or(1.0));
    let parent_height = if expanded {
        PINNED_TODO_WINDOW_EXPANDED_HEIGHT
    } else {
        PINNED_TODO_WINDOW_COLLAPSED_HEIGHT
    } * scale_factor;
    let window_width = if expanded {
        PINNED_SUBTASKS_WINDOW_EXPANDED_WIDTH
    } else {
        PINNED_SUBTASKS_WINDOW_COLLAPSED_WIDTH
    } * scale_factor;
    let window_height = target_height * scale_factor;
    let gap = PINNED_SUBTASKS_WINDOW_GAP * scale_factor;
    let monitor = main_window
        .as_ref()
        .and_then(|main| main.current_monitor().ok().flatten())
        .or_else(|| {
            main_window
                .as_ref()
                .and_then(|main| main.primary_monitor().ok().flatten())
        })
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| window.primary_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let work_area = monitor.work_area();
        let parent_y = work_area.position.y as f64
            + pinned_todo_slot_y(pinned, index, PINNED_TODO_WINDOW_MARGIN) * scale_factor;
        let x = work_area.position.x as f64 + work_area.size.width as f64 - window_width;
        let mut y = parent_y + parent_height + gap;
        let max_x = work_area.position.x as f64 + work_area.size.width as f64 - window_width;
        let max_y =
            work_area.position.y as f64 + work_area.size.height as f64 - window_height - gap;
        let min_x = work_area.position.x as f64 + gap;
        let min_y = work_area.position.y as f64 + gap;
        if y > max_y {
            y = parent_y - window_height - gap;
        }
        let _ = window.set_position(PhysicalPosition::new(
            x.clamp(min_x, max_x.max(min_x)),
            y.clamp(min_y, max_y.max(min_y)),
        ));
        let _ = window.set_size(PhysicalSize::new(window_width, window_height));
    } else {
        let _ = window.set_size(PhysicalSize::new(window_width, window_height));
    }
}

fn hide_mini_subtasks_windows(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if is_mini_subtasks_window_label(&label) {
            let _ = window.hide();
        }
    }
}

fn hide_extra_mini_subtasks_windows(app: &tauri::AppHandle, keep_count: usize) {
    for (label, window) in app.webview_windows() {
        if let Some(index) = mini_subtasks_window_index(&label) {
            if index >= keep_count {
                let _ = window.hide();
            }
        }
    }
}

fn mini_subtasks_window_index(label: &str) -> Option<usize> {
    if label == "mini-subtasks" {
        Some(0)
    } else {
        label
            .strip_prefix("mini-subtasks-")
            .and_then(|index| index.parse::<usize>().ok())
    }
}

fn is_mini_subtasks_window_label(label: &str) -> bool {
    mini_subtasks_window_index(label).is_some()
}

fn position_mini_subtasks_window(window: &tauri::WebviewWindow, item_count: usize) {
    let main_window = window
        .app_handle()
        .get_webview_window("main")
        .or_else(|| window.app_handle().get_webview_window("reminder"));

    if let Some(main_window) = main_window {
        if let (Ok(position), Ok(size)) = (main_window.outer_position(), main_window.outer_size()) {
            let scale_factor = main_window.scale_factor().unwrap_or(1.0);
            let window_height = mini_subtasks_window_height(item_count) * scale_factor;
            let stack_gap = MINI_SUBTASKS_WINDOW_STACK_GAP * scale_factor;
            let margin = MINI_SUBTASKS_WINDOW_MARGIN * scale_factor;
            let parent_inset = MINI_SUBTASKS_PARENT_INSET * scale_factor;
            let max_window_width = MINI_SUBTASKS_WINDOW_WIDTH * scale_factor;
            let parent_width = size.width as f64;
            let window_width = (parent_width - parent_inset * 2.0)
                .min(max_window_width)
                .max(1.0);
            let monitor = main_window
                .current_monitor()
                .ok()
                .flatten()
                .or_else(|| main_window.primary_monitor().ok().flatten());
            let (mut x, mut stack_y) = (
                position.x as f64 + ((parent_width - window_width) / 2.0).max(0.0),
                position.y as f64 + size.height as f64 + stack_gap,
            );

            if let Some(monitor) = monitor {
                let work_area = monitor.work_area();
                let min_x = work_area.position.x as f64 + margin;
                let max_x = work_area.position.x as f64 + work_area.size.width as f64
                    - window_width
                    - margin;
                let min_y = work_area.position.y as f64 + margin;
                let max_y = work_area.position.y as f64 + work_area.size.height as f64
                    - window_height
                    - margin;

                if stack_y > max_y {
                    stack_y = position.y as f64 - window_height - stack_gap;
                }
                x = x.clamp(min_x, max_x.max(min_x));
                stack_y = stack_y.clamp(min_y, max_y.max(min_y));
            }

            let _ = window.set_position(PhysicalPosition::new(x, stack_y));
            let _ = window.set_size(PhysicalSize::new(window_width, window_height));
            return;
        }
    }

    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let window_height = mini_subtasks_window_height(item_count) * scale_factor;
    let margin = MINI_SUBTASKS_WINDOW_MARGIN * scale_factor;
    let window_width = MINI_SUBTASKS_WINDOW_WIDTH * scale_factor;
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let work_area = monitor.work_area();
        let x = work_area.position.x as f64 + margin;
        let y = work_area.position.y as f64 + margin;
        let _ = window.set_position(PhysicalPosition::new(x, y));
        let _ = window.set_size(PhysicalSize::new(window_width, window_height));
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

#[cfg(windows)]
fn set_native_window_frame(
    window: &tauri::Window,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    use std::ffi::c_void;

    type Hwnd = *mut c_void;

    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(
            hwnd: Hwnd,
            hwnd_insert_after: Hwnd,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
    }

    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
    let result = unsafe {
        SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            (x * scale).round() as i32,
            (y * scale).round() as i32,
            (width * scale).round() as i32,
            (height * scale).round() as i32,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
    };
    if result == 0 {
        return Err("failed to set pinned window frame".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn set_native_window_frame(
    window: &tauri::Window,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    window
        .set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
fn bring_native_window_to_front(window: &tauri::WebviewWindow) -> Result<(), String> {
    use std::ffi::c_void;

    type Hwnd = *mut c_void;

    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOACTIVATE: u32 = 0x0010;

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(
            hwnd: Hwnd,
            hwnd_insert_after: Hwnd,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            flags: u32,
        ) -> i32;
    }

    let hwnd = window.hwnd().map_err(|error| error.to_string())?.0;
    let result = unsafe {
        SetWindowPos(
            hwnd,
            -1isize as Hwnd,
            0,
            0,
            0,
            0,
            SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE,
        )
    };
    if result == 0 {
        return Err("failed to bring pinned window to front".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn bring_native_window_to_front(window: &tauri::WebviewWindow) -> Result<(), String> {
    window.set_focus().map_err(|error| error.to_string())
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
        .manage(MiniSubtasksState(Mutex::new(None)))
        .manage(PinnedTodoState(Mutex::new(HashMap::new())))
        .manage(PinnedSubtasksState(Mutex::new(HashMap::new())))
        .manage(ClipboardMonitorState(Mutex::new(None)))
        .manage(ClipboardHistoryState {
            items: Mutex::new(Vec::new()),
            suppressed_fingerprint: Mutex::new(None),
            storage_path: Mutex::new(None),
        })
        .setup(move |app| {
            if let Some(state) = app.try_state::<ClipboardHistoryState>() {
                if let Ok(path) = clipboard_history_path(app.handle()) {
                    if let Ok(mut storage_path) = state.storage_path.lock() {
                        *storage_path = Some(path.clone());
                    }
                    if let Ok(mut items) = state.items.lock() {
                        *items = load_clipboard_history_from_path(&path);
                    }
                }
            }

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
            hide_mini_subtasks_windows(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_window_opacity,
            set_pinned_window_frame,
            bring_pinned_stack_to_front,
            hide_main_window,
            close_reminder_window,
            close_clipboard_window,
            close_mini_subtasks_window,
            show_clipboard_window,
            show_mini_subtasks_window,
            show_pinned_todo_window,
            get_active_pinned_todo,
            get_active_pinned_todos,
            remove_pinned_todo,
            get_active_pinned_subtasks_group,
            show_pinned_subtasks_window,
            close_pinned_subtasks_window,
            sync_pinned_subtasks_window,
            open_external_url,
            show_reminder_window,
            get_active_reminder_group,
            schedule_reminders,
            clear_active_reminder_group,
            get_active_mini_subtasks_group,
            get_clipboard_history,
            clear_clipboard_history,
            remove_clipboard_history_item,
            copy_clipboard_history_item,
            toggle_clipboard_history_pin,
            persist_todo_images,
            remove_todo_images,
            cleanup_todo_images
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
