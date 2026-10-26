use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

pub const FILE_NAME: &str = "sticky-notes.json";
pub static NOTES_LOCK: Mutex<()> = Mutex::new(());
static WINDOW_BUILD_LOCK: Mutex<()> = Mutex::new(());
static NEXT_ID: AtomicU64 = AtomicU64::new(0);
const COLORS: &[&str] = &["yellow", "green", "pink", "purple", "blue", "gray", "dark"];
const CHANGED_EVENT: &str = "dotime-sticky-notes-changed";
const MAX_HTML_BYTES: usize = 24 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteBounds {
    x: i32,
    y: i32,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StickyNote {
    id: String,
    html: String,
    color: String,
    pinned: bool,
    open: bool,
    created_at: u64,
    updated_at: u64,
    #[serde(default)]
    bounds: Option<NoteBounds>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePatch {
    html: Option<String>,
    color: Option<String>,
    pinned: Option<bool>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn load_notes(path: &Path) -> Result<Vec<StickyNote>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("便签数据无法读取，原文件已保留：{error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("无法读取便签：{error}")),
    }
}

fn store_notes(path: &Path, notes: &[StickyNote]) -> Result<(), String> {
    let parent = path.parent().ok_or("便签路径无效")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec(notes).map_err(|error| error.to_string())?;
    temporary
        .write_all(&bytes)
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary
        .persist(path)
        .map_err(|error| format!("便签保存失败：{error}"))?;
    Ok(())
}

// Read and patch under one lock: independent windows never overwrite each other's notes.
fn mutate_notes<T>(
    app: &tauri::AppHandle,
    change: impl FnOnce(&mut Vec<StickyNote>) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = NOTES_LOCK.lock().map_err(|error| error.to_string())?;
    let path = super::data_directory(app)?.join(FILE_NAME);
    let mut notes = load_notes(&path)?;
    let result = change(&mut notes)?;
    store_notes(&path, &notes)?;
    Ok(result)
}

fn find_note<'a>(notes: &'a mut [StickyNote], id: &str) -> Result<&'a mut StickyNote, String> {
    notes
        .iter_mut()
        .find(|note| note.id == id)
        .ok_or_else(|| "这张便签已被删除".into())
}

fn apply_patch(note: &mut StickyNote, patch: NotePatch) -> Result<(), String> {
    if patch
        .html
        .as_ref()
        .is_some_and(|html| html.len() > MAX_HTML_BYTES)
    {
        return Err("便签内容过大，请减少图片或文字后重试".into());
    }
    if patch
        .color
        .as_ref()
        .is_some_and(|color| !COLORS.contains(&color.as_str()))
    {
        return Err("不支持的便签颜色".into());
    }
    if let Some(html) = patch.html {
        note.html = html;
    }
    if let Some(color) = patch.color {
        note.color = color;
    }
    if let Some(pinned) = patch.pinned {
        note.pinned = pinned;
    }
    note.updated_at = now();
    Ok(())
}

fn label(id: &str) -> String {
    format!("sticky-note-{id}")
}

fn emit_changed(app: &tauri::AppHandle) {
    let _ = app.emit(CHANGED_EVENT, ());
}

fn show_window(app: &tauri::AppHandle, note: &StickyNote, focus: bool) -> Result<(), String> {
    let _guard = WINDOW_BUILD_LOCK
        .lock()
        .map_err(|error| error.to_string())?;
    let window_label = label(&note.id);
    let window = match app.get_webview_window(&window_label) {
        Some(window) => window,
        None => {
            let window = WebviewWindowBuilder::new(
                app,
                &window_label,
                WebviewUrl::App(format!("index.html?view=sticky-note&noteId={}", note.id).into()),
            )
            .title("doTime 便签")
            .decorations(false)
            .transparent(false)
            .shadow(true)
            .resizable(true)
            .visible(false)
            .focused(focus)
            .background_color(tauri::utils::config::Color(255, 248, 203, 255))
            .inner_size(360.0, 440.0)
            .min_inner_size(280.0, 260.0)
            .always_on_top(note.pinned)
            .build()
            .map_err(|error| error.to_string())?;

            // Restore physical screen position and logical size, including mixed-DPI monitors.
            let mut positioned = false;
            if let Some(bounds) = &note.bounds {
                if let Ok(monitors) = window.available_monitors() {
                    positioned = monitors.iter().any(|monitor| {
                        let p = monitor.position();
                        let s = monitor.size();
                        i64::from(bounds.x) >= i64::from(p.x)
                            && i64::from(bounds.y) >= i64::from(p.y)
                            && i64::from(bounds.x) + 120 <= i64::from(p.x) + i64::from(s.width)
                            && i64::from(bounds.y) + 80 <= i64::from(p.y) + i64::from(s.height)
                    });
                }
                if positioned {
                    let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
                    let _ = window.set_size(tauri::LogicalSize::new(
                        bounds.width.clamp(280.0, 1600.0),
                        bounds.height.clamp(260.0, 1400.0),
                    ));
                }
            }
            if !positioned {
                let _ = window.center();
                let offset = (app
                    .webview_windows()
                    .keys()
                    .filter(|key| key.starts_with("sticky-note-"))
                    .count()
                    .saturating_sub(1)
                    % 7) as i32
                    * 26;
                if let Ok(position) = window.outer_position() {
                    let _ = window.set_position(PhysicalPosition::new(
                        position.x + offset,
                        position.y + offset,
                    ));
                }
            }
            window
        }
    };
    let _ = window.unminimize();
    window.show().map_err(|error| error.to_string())?;
    if focus {
        let _ = window.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn list_sticky_notes(app: tauri::AppHandle) -> Result<Vec<StickyNote>, String> {
    let _guard = NOTES_LOCK.lock().map_err(|error| error.to_string())?;
    load_notes(&super::data_directory(&app)?.join(FILE_NAME))
}

#[tauri::command]
pub async fn create_sticky_note(
    app: tauri::AppHandle,
    color: Option<String>,
) -> Result<StickyNote, String> {
    let color = color.unwrap_or_else(|| "yellow".into());
    if !COLORS.contains(&color.as_str()) {
        return Err("不支持的便签颜色".into());
    }
    let timestamp = now();
    let note = StickyNote {
        id: format!("{timestamp}-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed)),
        html: String::new(),
        color,
        pinned: false,
        open: true,
        created_at: timestamp,
        updated_at: timestamp,
        bounds: None,
    };
    mutate_notes(&app, |notes| {
        notes.push(note.clone());
        Ok(())
    })?;
    show_window(&app, &note, true)?;
    emit_changed(&app);
    Ok(note)
}

#[tauri::command]
pub async fn open_sticky_note(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let note = mutate_notes(&app, |notes| {
        let note = find_note(notes, &id)?;
        note.open = true;
        Ok(note.clone())
    })?;
    show_window(&app, &note, true)?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn update_sticky_note(
    app: tauri::AppHandle,
    id: String,
    patch: NotePatch,
) -> Result<(), String> {
    let pinned = patch.pinned;
    let previous_pin = if let Some(pinned) = pinned {
        if let Some(window) = app.get_webview_window(&label(&id)) {
            let previous = window
                .is_always_on_top()
                .map_err(|error| error.to_string())?;
            window
                .set_always_on_top(pinned)
                .map_err(|error| error.to_string())?;
            Some((window, previous))
        } else {
            None
        }
    } else {
        None
    };
    if let Err(error) = mutate_notes(&app, |notes| apply_patch(find_note(notes, &id)?, patch)) {
        if let Some((window, previous)) = previous_pin {
            let _ = window.set_always_on_top(previous);
        }
        return Err(error);
    }
    emit_changed(&app);
    Ok(())
}

fn current_bounds(window: &tauri::WebviewWindow) -> Option<NoteBounds> {
    let position = window.outer_position().ok()?;
    let size = window
        .inner_size()
        .ok()?
        .to_logical::<f64>(window.scale_factor().ok()?);
    Some(NoteBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

#[tauri::command]
pub async fn save_sticky_note_bounds(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    if let Some(bounds) = current_bounds(&window) {
        mutate_notes(&app, |notes| {
            find_note(notes, &id)?.bounds = Some(bounds);
            Ok(())
        })?;
    }
    Ok(())
}

#[tauri::command]
pub async fn close_sticky_note(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: String,
) -> Result<(), String> {
    let bounds = current_bounds(&window);
    mutate_notes(&app, |notes| {
        let note = find_note(notes, &id)?;
        note.open = false;
        if bounds.is_some() {
            note.bounds = bounds;
        }
        Ok(())
    })?;
    window.destroy().map_err(|error| error.to_string())?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn delete_sticky_note(app: tauri::AppHandle, id: String) -> Result<(), String> {
    mutate_notes(&app, |notes| {
        notes.retain(|note| note.id != id);
        Ok(())
    })?;
    // A list can delete another note; only close the window belonging to that ID.
    let close_result = app
        .get_webview_window(&label(&id))
        .map(|window| window.destroy().map_err(|error| error.to_string()))
        .unwrap_or(Ok(()));
    emit_changed(&app);
    close_result
}

pub fn restore_open_windows(app: tauri::AppHandle) {
    match list_sticky_notes(app.clone()) {
        Ok(notes) => {
            for note in notes.iter().filter(|note| note.open) {
                if let Err(error) = show_window(&app, note, false) {
                    eprintln!("failed to restore sticky note: {error}");
                }
            }
        }
        Err(error) => eprintln!("failed to load sticky notes: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: &str) -> StickyNote {
        StickyNote {
            id: id.into(),
            html: "<b>记录</b>".into(),
            color: "yellow".into(),
            pinned: false,
            open: true,
            created_at: 1,
            updated_at: 1,
            bounds: None,
        }
    }

    #[test]
    fn roundtrip_preserves_multiple_notes_and_window_preferences() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(FILE_NAME);
        let mut first = note("one");
        first.pinned = true;
        first.color = "purple".into();
        first.bounds = Some(NoteBounds {
            x: -500,
            y: 120,
            width: 360.0,
            height: 440.0,
        });
        let mut second = note("two");
        second.open = false;
        store_notes(&path, &[first, second]).unwrap();
        let notes = load_notes(&path).unwrap();
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].html, "<b>记录</b>");
        assert!(notes[0].pinned);
        assert_eq!(notes[0].color, "purple");
        assert_eq!(notes[0].bounds.as_ref().unwrap().x, -500);
        assert!(!notes[1].open);
        store_notes(&path, &notes[..1]).unwrap();
        assert_eq!(load_notes(&path).unwrap().len(), 1);
    }

    #[test]
    fn patch_changes_only_target_note_and_supplied_fields() {
        let mut notes = vec![note("one"), note("two")];
        apply_patch(
            find_note(&mut notes, "two").unwrap(),
            NotePatch {
                html: Some("<i>新内容</i>".into()),
                color: None,
                pinned: Some(true),
            },
        )
        .unwrap();
        assert_eq!(notes[0].html, "<b>记录</b>");
        assert_eq!(notes[1].html, "<i>新内容</i>");
        assert_eq!(notes[1].color, "yellow");
        assert!(notes[1].pinned);
        assert!(find_note(&mut notes, "deleted").is_err());
    }

    #[test]
    fn invalid_patch_is_rejected_before_mutating_note() {
        let mut note = note("one");
        assert!(apply_patch(
            &mut note,
            NotePatch {
                html: Some("changed".into()),
                color: Some("invalid".into()),
                pinned: None
            }
        )
        .is_err());
        assert_eq!(note.html, "<b>记录</b>");
    }

    #[test]
    fn corrupted_data_is_reported_and_preserved() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join(FILE_NAME);
        assert!(load_notes(&path).unwrap().is_empty());
        fs::write(&path, "corrupted").unwrap();
        assert!(load_notes(&path).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "corrupted");
    }
}
