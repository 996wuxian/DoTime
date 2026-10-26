//! Hidden WebView2 stress fixture. Never reads the user's doTime data directory.
//! See scripts/benchmark-sticky-notes.ps1 for build and measurement instructions.
#![allow(dead_code)]

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[path = "../src/sticky_notes.rs"]
mod sticky_notes;

static READY: AtomicUsize = AtomicUsize::new(0);

fn data_directory(_: &tauri::AppHandle) -> Result<PathBuf, String> {
    std::env::var_os("DOTIME_BENCH_DIR")
        .map(PathBuf::from)
        .ok_or_else(|| "DOTIME_BENCH_DIR is required; production data is never used".into())
}

#[tauri::command]
fn benchmark_ready() {
    READY.fetch_add(1, Ordering::SeqCst);
}

#[tauri::command]
fn read_data_file(app: tauri::AppHandle, file_name: String) -> Result<Option<String>, String> {
    let path = data_directory(&app)?.join(file_name);
    Ok(fs::read_to_string(path).ok())
}

fn phase(directory: &std::path::Path, name: &str) {
    fs::write(directory.join("phase.txt"), name).unwrap();
    println!("{}", serde_json::json!({"phase": name}));
    let _ = std::io::stdout().flush();
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let a = chunk[0] as usize;
        let b = *chunk.get(1).unwrap_or(&0) as usize;
        let c = *chunk.get(2).unwrap_or(&0) as usize;
        out.push(TABLE[a >> 2] as char);
        out.push(TABLE[((a & 3) << 4) | (b >> 4)] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((b & 15) << 2) | (c >> 6)] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[c & 63] as char
        } else {
            '='
        });
    }
    out
}

fn seed(directory: &std::path::Path, count: usize) {
    fs::create_dir_all(directory).unwrap();
    // Valid 256 x 256 BMP: ~256 KiB of inline image data on half the notes.
    let mut bmp = vec![0_u8; 54 + 256 * 256 * 3];
    let length = bmp.len() as u32;
    bmp[0..2].copy_from_slice(b"BM");
    bmp[2..6].copy_from_slice(&length.to_le_bytes());
    bmp[10..14].copy_from_slice(&54_u32.to_le_bytes());
    bmp[14..18].copy_from_slice(&40_u32.to_le_bytes());
    bmp[18..22].copy_from_slice(&256_i32.to_le_bytes());
    bmp[22..26].copy_from_slice(&256_i32.to_le_bytes());
    bmp[26..28].copy_from_slice(&1_u16.to_le_bytes());
    bmp[28..30].copy_from_slice(&24_u16.to_le_bytes());
    for (index, value) in bmp.iter_mut().enumerate().skip(54) {
        *value = (index.wrapping_mul(73) % 251) as u8;
    }
    let image = format!(
        "<img src=\"data:image/bmp;base64,{}\" alt=\"测试图片\">",
        encode_base64(&bmp)
    );
    let notes: Vec<_> = (0..count).map(|index| serde_json::json!({
        "id": format!("bench-{index}"),
        "html": format!("<p>便签 {index}：{}</p>{}", "这是独立的压力测试数据，用来验证多便签性能。".repeat(32), if index % 2 == 0 { image.as_str() } else { "" }),
        "color": "yellow", "pinned": false, "open": true,
        "createdAt": 1, "updatedAt": 1, "bounds": null,
    })).collect();
    fs::write(
        directory.join("sticky-notes.json"),
        serde_json::to_vec(&notes).unwrap(),
    )
    .unwrap();
    let todos: Vec<_> = (0..3000).map(|index| serde_json::json!({
        "id": format!("todo-{index}"), "title": "独立测试任务".repeat(4), "date": "2026-10-26", "completed": false,
    })).collect();
    let app_data = serde_json::to_vec(&serde_json::json!({"version": 2, "updatedAt": 1, "todos": todos, "categoryDividers": [], "manualSortDates": []})).unwrap();
    for name in [
        "app-data.json",
        "app-data-backup-1.json",
        "app-data-backup-2.json",
        "app-data-backup-3.json",
    ] {
        fs::write(directory.join(name), &app_data).unwrap();
    }
    for name in ["task-templates.json", "task-templates-backup.json"] {
        fs::write(directory.join(name), "[]").unwrap();
    }
}

fn main() {
    let count: usize = std::env::var("DOTIME_BENCH_COUNT")
        .unwrap_or_else(|_| "1".into())
        .parse()
        .unwrap();
    assert!((1..=30).contains(&count));
    let directory =
        PathBuf::from(std::env::var_os("DOTIME_BENCH_DIR").expect("test directory required"));
    seed(&directory, count);
    phase(&directory, "startup");
    let context = tauri::generate_context!();
    assert!(
        context.config().identifier.ends_with(".sticky-stress"),
        "build with the dedicated benchmark identifier"
    );
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            benchmark_ready, read_data_file,
            sticky_notes::list_sticky_notes,
            sticky_notes::get_sticky_note,
            sticky_notes::list_sticky_note_summaries,
            sticky_notes::create_sticky_note,
            sticky_notes::open_sticky_note,
            sticky_notes::update_sticky_note,
            sticky_notes::save_sticky_note_bounds,
            sticky_notes::close_sticky_note,
            sticky_notes::delete_sticky_note,
        ])
        .setup(move |app| {
            let app = app.handle().clone();
            std::thread::spawn(move || {
                let started = Instant::now();
                for index in 0..count {
                    WebviewWindowBuilder::new(&app, format!("sticky-note-bench-{index}"), WebviewUrl::App(format!("index.html?view=sticky-note&noteId=bench-{index}").into()))
                        .visible(false).focused(false).decorations(false).inner_size(360.0, 440.0)
                        .data_directory(directory.join("webview-profile"))
                        .initialization_script("const readyTimer = setInterval(() => { if (document.querySelector('.sticky-note__editor')) { clearInterval(readyTimer); window.__TAURI_INTERNALS__.invoke('benchmark_ready'); } }, 100);")
                        .build().unwrap();
                }
                while READY.load(Ordering::SeqCst) < count {
                    if started.elapsed() > Duration::from_secs(90) { phase(&directory, "load-timeout"); app.exit(2); return; }
                    std::thread::sleep(Duration::from_millis(100));
                }
                fs::write(directory.join("startup-ms.txt"), started.elapsed().as_millis().to_string()).unwrap();
                phase(&directory, "idle");
                std::thread::sleep(Duration::from_secs(6));
                phase(&directory, "editing");
                for _ in 0..8 {
                    for window in app.webview_windows().values() {
                        let _ = window.eval("{ const editor = document.querySelector('.sticky-note__editor'); if (editor) { editor.append(document.createTextNode(' 压测输入')); editor.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText'})); } }");
                    }
                    std::thread::sleep(Duration::from_millis(600));
                }
                std::thread::sleep(Duration::from_secs(2));
                phase(&directory, "settled");
                std::thread::sleep(Duration::from_secs(4));
                let windows: Vec<_> = app.webview_windows().into_values().collect();
                for window in windows.iter().take(count / 2) { let _ = window.destroy(); }
                phase(&directory, "half-closed");
                std::thread::sleep(Duration::from_secs(6));
                phase(&directory, "complete");
                app.exit(0);
            });
            Ok(())
        })
        .run(context).expect("hidden benchmark application failed");
}
