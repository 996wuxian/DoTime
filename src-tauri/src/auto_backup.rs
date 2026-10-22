use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::Manager;

const DAY_MS: u64 = 24 * 60 * 60 * 1000;
const BACKUP_MARKER: &str = "dotime-auto-backup-v1";
static BACKUP_LOCK: Mutex<()> = Mutex::new(());
static NEXT_FILE_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BackupSettings {
    enabled: bool,
    directory: String,
    keep_count: usize,
    last_success_at: Option<u64>,
    last_attempt_at: Option<u64>,
    last_backup_file: Option<String>,
    last_error: Option<String>,
    last_warning: Option<String>,
}

impl Default for BackupSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            directory: String::new(),
            keep_count: 7,
            last_success_at: None,
            last_attempt_at: None,
            last_backup_file: None,
            last_error: None,
            last_warning: None,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    #[serde(flatten)]
    settings: BackupSettings,
    default_directory: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupOutcome {
    status: BackupStatus,
    created: bool,
}

fn paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let config = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    Ok((
        config.join("automatic-backup.json"),
        super::data_directory(app)?.join("auto-backups"),
    ))
}

fn load_settings(config: &Path, default_directory: &Path) -> Result<BackupSettings, String> {
    let mut settings: BackupSettings = match fs::read(config) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| "自动备份设置无法读取，请检查配置文件。".to_owned())?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => BackupSettings::default(),
        Err(error) => return Err(format!("无法读取自动备份设置：{error}")),
    };
    if settings.directory.is_empty() {
        settings.directory = default_directory.to_string_lossy().into_owned();
    }
    validate_settings(&settings)?;
    Ok(settings)
}

fn validate_settings(settings: &BackupSettings) -> Result<(), String> {
    if !matches!(settings.keep_count, 7 | 30) {
        return Err("备份保留数量只能选择 7 份或 30 份。".into());
    }
    let directory = Path::new(&settings.directory);
    if !directory.is_absolute() || directory.parent().is_none() {
        return Err("请选择一个完整的备份文件夹路径，不能使用磁盘根目录。".into());
    }
    Ok(())
}

fn atomic_write(path: &Path, content: &[u8], replace: bool) -> Result<(), String> {
    let parent = path.parent().ok_or("文件路径无效。")?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建备份目录：{error}"))?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    temporary
        .write_all(content)
        .map_err(|error| format!("备份写入失败：{error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("备份写入未完成：{error}"))?;
    if replace {
        temporary.persist(path).map_err(|error| error.to_string())?;
    } else {
        temporary
            .persist_noclobber(path)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn store_settings(config: &Path, settings: &BackupSettings) -> Result<(), String> {
    atomic_write(
        config,
        &serde_json::to_vec_pretty(settings).map_err(|error| error.to_string())?,
        true,
    )
}

fn status(settings: BackupSettings, default_directory: &Path) -> BackupStatus {
    BackupStatus {
        settings,
        default_directory: default_directory.to_string_lossy().into_owned(),
    }
}

fn managed_file_time(name: &str) -> Option<u64> {
    let stem = name.strip_prefix("doTime-auto-")?.strip_suffix(".json")?;
    let (time, sequence) = stem.split_once('-')?;
    if time.is_empty()
        || sequence.is_empty()
        || !time.bytes().all(|value| value.is_ascii_digit())
        || !sequence.bytes().all(|value| value.is_ascii_digit())
    {
        return None;
    }
    time.parse().ok()
}

fn rotate_backups(directory: &Path, keep_count: usize, newest: &Path) -> Result<(), String> {
    let directory = fs::canonicalize(directory).map_err(|error| error.to_string())?;
    let newest = fs::canonicalize(newest).map_err(|error| error.to_string())?;
    let mut owned = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        // Do not follow symbolic links or touch folders and unrelated JSON exports.
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            continue;
        }
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let Some(time) = managed_file_time(&name) else {
            continue;
        };
        let bytes = fs::read(entry.path()).map_err(|error| error.to_string())?;
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
            continue;
        };
        if value["automaticBackup"]["kind"] != BACKUP_MARKER
            || value["automaticBackup"]["createdAt"].as_u64() != Some(time)
        {
            continue;
        }
        let path = fs::canonicalize(entry.path()).map_err(|error| error.to_string())?;
        if path.parent() != Some(directory.as_path()) || path == newest {
            continue;
        }
        owned.push((time, name, path));
    }
    owned.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    for (_, _, path) in owned.into_iter().skip(keep_count.saturating_sub(1)) {
        fs::remove_file(path).map_err(|error| format!("旧备份未能清理：{error}"))?;
    }
    Ok(())
}

fn write_backup(
    config: &Path,
    default_directory: &Path,
    content: &str,
    force: bool,
    now: u64,
) -> Result<BackupOutcome, String> {
    let mut settings = load_settings(config, default_directory)?;
    if !force
        && (!settings.enabled
            || settings
                .last_success_at
                .is_some_and(|last| now.saturating_sub(last) < DAY_MS))
    {
        return Ok(BackupOutcome {
            status: status(settings, default_directory),
            created: false,
        });
    }
    settings.last_attempt_at = Some(now);
    let attempt = || -> Result<PathBuf, String> {
        let mut document: serde_json::Value =
            serde_json::from_str(content).map_err(|_| "备份内容不是有效的 JSON。".to_owned())?;
        if document["format"] != "dotime-backup"
            || document["version"] != 1
            || !document["appData"]["todos"].is_array()
            || !document["templates"].is_array()
        {
            return Err("备份内容不完整，已有备份保持不变。".into());
        }
        document["automaticBackup"] =
            serde_json::json!({ "kind": BACKUP_MARKER, "createdAt": now });
        let bytes = serde_json::to_vec_pretty(&document).map_err(|error| error.to_string())?;
        let directory = PathBuf::from(&settings.directory);
        fs::create_dir_all(&directory).map_err(|error| format!("备份目录不可用：{error}"))?;
        let directory = fs::canonicalize(directory).map_err(|error| error.to_string())?;
        let sequence = NEXT_FILE_ID.fetch_add(1, Ordering::Relaxed);
        let path = directory.join(format!("doTime-auto-{now}-{sequence}.json"));
        atomic_write(&path, &bytes, false)?;
        Ok(path)
    };
    let path = match attempt() {
        Ok(path) => path,
        Err(error) => {
            settings.last_error = Some(error.clone());
            let _ = store_settings(config, &settings);
            return Err(error);
        }
    };
    settings.last_success_at = Some(now);
    settings.last_backup_file = Some(path.to_string_lossy().into_owned());
    settings.last_error = None;
    settings.last_warning = None;
    // Record success before rotation. A failed write or config save must not remove old backups.
    store_settings(config, &settings)?;
    settings.last_warning =
        rotate_backups(Path::new(&settings.directory), settings.keep_count, &path).err();
    if settings.last_warning.is_some() {
        let _ = store_settings(config, &settings);
    }
    Ok(BackupOutcome {
        status: status(settings, default_directory),
        created: true,
    })
}

#[tauri::command]
pub fn get_auto_backup_status(app: tauri::AppHandle) -> Result<BackupStatus, String> {
    let (config, default_directory) = paths(&app)?;
    Ok(status(
        load_settings(&config, &default_directory)?,
        &default_directory,
    ))
}

#[tauri::command]
pub fn save_auto_backup_settings(
    app: tauri::AppHandle,
    enabled: bool,
    directory: String,
    keep_count: usize,
) -> Result<BackupStatus, String> {
    let _guard = BACKUP_LOCK.lock().map_err(|error| error.to_string())?;
    let (config, default_directory) = paths(&app)?;
    let mut settings = load_settings(&config, &default_directory)?;
    let next_directory = directory.trim().to_owned();
    if next_directory != settings.directory {
        settings.last_success_at = None;
        settings.last_attempt_at = None;
        settings.last_backup_file = None;
        settings.last_error = None;
        settings.last_warning = None;
    }
    settings.directory = next_directory;
    settings.enabled = enabled;
    settings.keep_count = keep_count;
    validate_settings(&settings)?;
    store_settings(&config, &settings)?;
    Ok(status(settings, &default_directory))
}

#[tauri::command]
pub async fn write_auto_backup(
    app: tauri::AppHandle,
    content: String,
    force: bool,
) -> Result<BackupOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = BACKUP_LOCK.lock().map_err(|error| error.to_string())?;
        let (config, default_directory) = paths(&app)?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis() as u64;
        write_backup(&config, &default_directory, &content, force, now)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn open_auto_backup_directory(app: tauri::AppHandle) -> Result<(), String> {
    let (config, default_directory) = paths(&app)?;
    let settings = load_settings(&config, &default_directory)?;
    let directory = Path::new(&settings.directory);
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    #[cfg(windows)]
    let result = std::process::Command::new("explorer")
        .arg(directory)
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(directory).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open")
        .arg(directory)
        .spawn();
    result.map(|_| ()).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content() -> String {
        serde_json::json!({ "format": "dotime-backup", "version": 1, "exportedAt": 1,
            "appData": { "version": 2, "todos": [], "trash": [], "categoryDividers": [], "manualSortDates": [] }, "templates": [] }).to_string()
    }

    #[test]
    fn creates_atomic_portable_backups_and_rechecks_daily_schedule() {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config.json");
        let directory = root.path().join("backups");
        let first = write_backup(&config, &directory, &content(), false, DAY_MS).unwrap();
        assert!(first.created);
        let file = PathBuf::from(first.status.settings.last_backup_file.unwrap());
        let document: serde_json::Value = serde_json::from_slice(&fs::read(file).unwrap()).unwrap();
        assert_eq!(document["format"], "dotime-backup");
        assert_eq!(document["automaticBackup"]["kind"], BACKUP_MARKER);
        assert!(
            !write_backup(&config, &directory, &content(), false, DAY_MS + 1)
                .unwrap()
                .created
        );
        assert!(
            write_backup(&config, &directory, &content(), false, DAY_MS * 2)
                .unwrap()
                .created
        );
        assert!(fs::read_dir(directory).unwrap().all(|entry| entry
            .unwrap()
            .path()
            .extension()
            .unwrap()
            == "json"));
    }

    #[test]
    fn rotates_only_owned_files_and_keeps_the_new_backup_even_when_clock_goes_back() {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config.json");
        let directory = root.path().join("backups");
        for day in 1..=9 {
            write_backup(&config, &directory, &content(), true, DAY_MS * day).unwrap();
        }
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 7);
        fs::write(directory.join("manual-export.json"), "keep").unwrap();
        fs::write(
            directory.join("doTime-auto-1-100.json"),
            "{\"userFile\":true}",
        )
        .unwrap();
        fs::create_dir(directory.join("doTime-auto-2-100.json")).unwrap();
        let latest = write_backup(&config, &directory, &content(), true, 1).unwrap();
        assert!(Path::new(latest.status.settings.last_backup_file.as_ref().unwrap()).is_file());
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 10);
        assert_eq!(
            fs::read_to_string(directory.join("manual-export.json")).unwrap(),
            "keep"
        );
        assert!(directory.join("doTime-auto-2-100.json").is_dir());
    }

    #[test]
    fn failures_preserve_existing_backups_and_record_the_error_without_advancing_success() {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config.json");
        let directory = root.path().join("backups");
        let first = write_backup(&config, &directory, &content(), true, DAY_MS).unwrap();
        let original = first.status.settings.last_backup_file.unwrap();
        assert!(write_backup(&config, &directory, "invalid", true, DAY_MS * 2).is_err());
        assert!(Path::new(&original).exists());
        let saved = load_settings(&config, &directory).unwrap();
        assert_eq!(saved.last_success_at, Some(DAY_MS));
        assert!(saved.last_error.is_some());
        assert_eq!(fs::read_dir(directory).unwrap().count(), 1);
    }

    #[test]
    fn an_unavailable_destination_does_not_touch_previous_backups() {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config.json");
        let directory = root.path().join("backups");
        let first = write_backup(&config, &directory, &content(), true, DAY_MS).unwrap();
        let original = first.status.settings.last_backup_file.unwrap();
        let blocked = root.path().join("a-file-not-a-folder");
        fs::write(&blocked, "unrelated content").unwrap();
        let mut settings = load_settings(&config, &directory).unwrap();
        settings.directory = blocked.to_string_lossy().into_owned();
        store_settings(&config, &settings).unwrap();
        assert!(write_backup(&config, &directory, &content(), true, DAY_MS * 2).is_err());
        assert!(Path::new(&original).is_file());
        assert_eq!(fs::read_to_string(blocked).unwrap(), "unrelated content");
        assert_eq!(
            load_settings(&config, &directory).unwrap().last_success_at,
            Some(DAY_MS)
        );
    }

    #[test]
    fn disabled_automatic_backups_can_still_be_run_manually() {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config.json");
        let directory = root.path().join("backups");
        let mut settings = load_settings(&config, &directory).unwrap();
        settings.enabled = false;
        settings.keep_count = 30;
        store_settings(&config, &settings).unwrap();
        assert!(
            !write_backup(&config, &directory, &content(), false, DAY_MS)
                .unwrap()
                .created
        );
        assert!(
            write_backup(&config, &directory, &content(), true, DAY_MS)
                .unwrap()
                .created
        );
        assert_eq!(load_settings(&config, &directory).unwrap().keep_count, 30);
    }

    #[test]
    fn supports_thirty_backup_retention_without_changing_other_files() {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config.json");
        let directory = root.path().join("backups");
        let mut settings = load_settings(&config, &directory).unwrap();
        settings.keep_count = 30;
        store_settings(&config, &settings).unwrap();
        for day in 1..=31 {
            write_backup(&config, &directory, &content(), true, DAY_MS * day).unwrap();
        }
        assert_eq!(fs::read_dir(directory).unwrap().count(), 30);
    }

    #[test]
    fn invalid_settings_and_unrecognized_names_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let config = root.path().join("config.json");
        fs::write(&config, "broken").unwrap();
        assert!(load_settings(&config, root.path()).is_err());
        assert!(validate_settings(&BackupSettings {
            directory: "relative/path".into(),
            ..Default::default()
        })
        .is_err());
        assert!(validate_settings(&BackupSettings {
            directory: root.path().to_string_lossy().into_owned(),
            keep_count: 0,
            ..Default::default()
        })
        .is_err());
        for name in [
            "../doTime-auto-1-1.json",
            "doTime-auto-1-../x.json",
            "manual.json",
            "doTime-auto-1-1.tmp",
        ] {
            assert!(managed_file_time(name).is_none());
        }
    }
}
