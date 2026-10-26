use super::{NoteSummary, StickyNote};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub(super) const DIRECTORY_NAME: &str = "sticky-notes";
const FORMAT_MARKER: &str = "dotime-sticky-notes-v1";

pub(super) struct NoteRepository {
    pub root: PathBuf,
    notes: HashMap<String, StickyNote>,
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err("便签标识无效，原文件已保留".into());
    }
    Ok(())
}

fn atomic_write(
    path: &Path,
    write: impl FnOnce(&mut fs::File) -> Result<(), String>,
) -> Result<(), String> {
    let parent = path.parent().ok_or("便签路径无效")?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
    write(temporary.as_file_mut())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary
        .persist(path)
        .map_err(|error| format!("便签保存失败：{error}"))?;
    Ok(())
}

fn write_note(directory: &Path, note: &StickyNote) -> Result<(), String> {
    validate_id(&note.id)?;
    atomic_write(&directory.join(format!("{}.json", note.id)), |file| {
        serde_json::to_writer(file, note).map_err(|error| error.to_string())
    })
}

impl NoteRepository {
    pub fn load(root: &Path) -> Result<Self, String> {
        let directory = root.join(DIRECTORY_NAME);
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
        let marker = directory.join(".format");
        match fs::read_to_string(&marker) {
            Ok(format) if format == FORMAT_MARKER => {}
            Ok(_) => return Err("便签数据版本无法识别，原文件已保留".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let legacy = super::load_notes(&root.join(super::FILE_NAME))?;
                let mut ids = HashSet::new();
                for note in &legacy {
                    validate_id(&note.id)?;
                    if !ids.insert(&note.id) {
                        return Err("旧便签存在重复标识，原文件已保留".into());
                    }
                }
                for mut note in legacy {
                    note.text = Some(text_from_html(&note.html));
                    write_note(&directory, &note)?;
                }
                // Only switch to individual files after every legacy note is durable.
                // Keep the legacy file untouched as a migration backup.
                atomic_write(&marker, |file| {
                    file.write_all(FORMAT_MARKER.as_bytes())
                        .map_err(|error| error.to_string())
                })?;
            }
            Err(error) => return Err(error.to_string()),
        }
        let mut notes = HashMap::new();
        for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let bytes = fs::read(&path).map_err(|error| error.to_string())?;
            let mut note: StickyNote = serde_json::from_slice(&bytes)
                .map_err(|error| format!("便签文件无法读取，原文件已保留：{error}"))?;
            validate_id(&note.id)?;
            if path.file_stem().and_then(|value| value.to_str()) != Some(&note.id) {
                return Err("便签标识与文件名不匹配，原文件已保留".into());
            }
            if note.text.is_none() {
                note.text = Some(text_from_html(&note.html));
            }
            notes.insert(note.id.clone(), note);
        }
        Ok(Self {
            root: root.into(),
            notes,
        })
    }

    pub fn get(&self, id: &str) -> Option<StickyNote> {
        self.notes.get(id).cloned()
    }

    pub fn all(&self) -> Vec<StickyNote> {
        self.notes.values().cloned().collect()
    }

    pub fn summaries(&self) -> Vec<NoteSummary> {
        self.notes
            .values()
            .map(|note| NoteSummary {
                id: note.id.clone(),
                color: note.color.clone(),
                pinned: note.pinned,
                open: note.open,
                created_at: note.created_at,
                updated_at: note.updated_at,
                text: note.text.clone().unwrap_or_default(),
            })
            .collect()
    }

    pub fn insert(&mut self, note: StickyNote) -> Result<(), String> {
        if self.notes.contains_key(&note.id) {
            return Err("便签标识已存在".into());
        }
        write_note(&self.root.join(DIRECTORY_NAME), &note)?;
        self.notes.insert(note.id.clone(), note);
        Ok(())
    }

    pub fn update(
        &mut self,
        id: &str,
        change: impl FnOnce(&mut StickyNote) -> Result<(), String>,
    ) -> Result<StickyNote, String> {
        let original = self.notes.get(id).ok_or("这张便签已被删除")?;
        let mut changed = original.clone();
        change(&mut changed)?;
        if &changed != original {
            write_note(&self.root.join(DIRECTORY_NAME), &changed)?;
            self.notes.insert(id.into(), changed.clone());
        }
        Ok(changed)
    }

    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        validate_id(id)?;
        if !self.notes.contains_key(id) {
            return Ok(());
        }
        match fs::remove_file(self.root.join(DIRECTORY_NAME).join(format!("{id}.json"))) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        self.notes.remove(id);
        Ok(())
    }
}

// Used once for legacy notes; subsequent edits supply plain text from the editor.
// Scan tags without ever copying inline image payloads into preview strings.
pub(super) fn text_from_html(html: &str) -> String {
    let mut text = String::with_capacity(html.len().min(4096));
    let mut chars = html.chars().peekable();
    let mut has_image = false;
    while let Some(c) = chars.next() {
        if c == '<' {
            let mut tag = String::new();
            let mut quote = None;
            for c in chars.by_ref() {
                if let Some(active) = quote {
                    if c == active {
                        quote = None;
                    }
                } else if c == '\'' || c == '"' {
                    quote = Some(c);
                } else if c == '>' {
                    break;
                }
                if tag.len() < 12 {
                    tag.push(c.to_ascii_lowercase());
                }
            }
            let name = tag
                .trim_start_matches('/')
                .split_whitespace()
                .next()
                .unwrap_or("");
            has_image |= name == "img";
            if matches!(name, "p" | "div" | "br" | "li" | "ul" | "ol" | "blockquote") {
                text.push(' ');
            }
        } else if c == '&' {
            let mut entity = String::new();
            while entity.len() < 12
                && chars
                    .peek()
                    .is_some_and(|c| c.is_ascii_alphanumeric() || *c == '#')
            {
                entity.push(chars.next().unwrap());
            }
            if chars.peek() == Some(&';') {
                chars.next();
                let decoded = match entity.as_str() {
                    "amp" => Some('&'),
                    "lt" => Some('<'),
                    "gt" => Some('>'),
                    "quot" => Some('"'),
                    "apos" => Some('\''),
                    "nbsp" => Some(' '),
                    _ => entity
                        .strip_prefix("#x")
                        .or_else(|| entity.strip_prefix("#X"))
                        .and_then(|n| u32::from_str_radix(n, 16).ok())
                        .or_else(|| entity.strip_prefix('#').and_then(|n| n.parse().ok()))
                        .and_then(char::from_u32),
                };
                if let Some(c) = decoded {
                    text.push(c);
                } else {
                    text.push('&');
                    text.push_str(&entity);
                    text.push(';');
                }
            } else {
                text.push('&');
                text.push_str(&entity);
            }
        } else {
            text.push(c);
        }
    }
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        if has_image {
            "图片便签".into()
        } else {
            String::new()
        }
    } else {
        normalized
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn note(id: &str) -> StickyNote {
        StickyNote {
            id: id.into(),
            html: "<p>旧便签 &amp; 内容</p>".into(),
            text: None,
            color: "pink".into(),
            pinned: true,
            open: true,
            created_at: 1,
            updated_at: 1,
            bounds: None,
        }
    }

    #[test]
    fn migrates_without_touching_original_and_does_not_resurrect_deleted_notes() {
        let directory = tempfile::tempdir().unwrap();
        let legacy_path = directory.path().join(super::super::FILE_NAME);
        let legacy = serde_json::to_vec(&vec![note("one"), note("two")]).unwrap();
        fs::write(&legacy_path, &legacy).unwrap();
        let mut repository = NoteRepository::load(directory.path()).unwrap();
        assert_eq!(repository.summaries()[0].text, "旧便签 & 内容");
        repository.remove("one").unwrap();
        let reloaded = NoteRepository::load(directory.path()).unwrap();
        assert!(reloaded.get("one").is_none());
        assert!(reloaded.get("two").unwrap().pinned);
        assert_eq!(fs::read(legacy_path).unwrap(), legacy);
    }

    #[test]
    fn updating_one_note_never_rewrites_others_and_skips_noops() {
        let directory = tempfile::tempdir().unwrap();
        let mut repository = NoteRepository::load(directory.path()).unwrap();
        repository.insert(note("one")).unwrap();
        repository.insert(note("two")).unwrap();
        let other_path = directory.path().join(DIRECTORY_NAME).join("two.json");
        let before = fs::read(&other_path).unwrap();
        let modified = fs::metadata(&other_path).unwrap().modified().unwrap();
        repository
            .update("one", |note| {
                note.html = "<b>更改</b>".into();
                Ok(())
            })
            .unwrap();
        repository.update("two", |_| Ok(())).unwrap();
        assert_eq!(fs::read(&other_path).unwrap(), before);
        assert_eq!(
            fs::metadata(&other_path).unwrap().modified().unwrap(),
            modified
        );
        assert_eq!(
            NoteRepository::load(directory.path())
                .unwrap()
                .get("one")
                .unwrap()
                .html,
            "<b>更改</b>"
        );
    }

    #[test]
    fn corrupted_legacy_and_unsafe_ids_never_commit_migration() {
        let directory = tempfile::tempdir().unwrap();
        let legacy = directory.path().join(super::super::FILE_NAME);
        fs::write(&legacy, "corrupt").unwrap();
        assert!(NoteRepository::load(directory.path()).is_err());
        assert!(!directory
            .path()
            .join(DIRECTORY_NAME)
            .join(".format")
            .exists());
        fs::write(
            &legacy,
            serde_json::to_vec(&vec![note("../escape")]).unwrap(),
        )
        .unwrap();
        assert!(NoteRepository::load(directory.path()).is_err());
        assert!(!directory
            .path()
            .join(DIRECTORY_NAME)
            .join(".format")
            .exists());
    }

    #[test]
    fn failures_do_not_commit_cached_state_or_recreate_a_deleted_note() {
        let directory = tempfile::tempdir().unwrap();
        let mut repository = NoteRepository::load(directory.path()).unwrap();
        repository.insert(note("one")).unwrap();
        assert!(repository
            .update("one", |note| {
                note.color = "blue".into();
                Err("failed".into())
            })
            .is_err());
        assert_eq!(repository.get("one").unwrap().color, "pink");
        repository.remove("one").unwrap();
        assert!(repository.update("one", |_| Ok(())).is_err());
        fs::create_dir(directory.path().join(DIRECTORY_NAME).join("blocked.json")).unwrap();
        assert!(repository.insert(note("blocked")).is_err());
        assert!(repository.get("blocked").is_none());
    }

    #[test]
    fn summaries_exclude_html_images_and_decode_search_text() {
        let html = format!(
            "<p>查找 &lt;项目&gt; &#x4e2d;&#25991;</p><img src=\"data:image/png;base64,{}\">",
            "A".repeat(1024 * 1024)
        );
        assert_eq!(text_from_html(&html), "查找 <项目> 中文");
        assert_eq!(
            text_from_html("<img src=\"data:image/png;base64,AAAA\">"),
            "图片便签"
        );
    }
}
