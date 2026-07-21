use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use std::sync::Arc;

use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Manager, State};
use ts_rs::TS;

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};

use crate::gitx::checkpoints::CheckpointEngine;
use crate::state::{AppState, RecentProject};

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/ProjectInfo.ts")]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/DirEntryInfo.ts")]
pub struct DirEntryInfo {
    pub path: String,
    pub name: String,
    pub kind: EntryKind,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/EntryKind.ts")]
pub enum EntryKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/FileReadResult.ts")]
pub struct FileReadResult {
    pub path: String,
    pub content: String,
    pub hash: String,
    pub truncated: bool,
    /// True when any line exceeds the editor's safe threshold; frontend
    /// opens the buffer read-only without language highlighting.
    pub long_lines: bool,
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/FileWriteResult.ts")]
pub struct FileWriteResult {
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/FsEvent.ts")]
pub struct FsEvent {
    pub watcher_id: u64,
    pub kind: String,
    pub paths: Vec<String>,
}

#[tauri::command]
pub fn project_open(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<ProjectInfo, String> {
    let project_path = canonical_dir(&path)?;
    let name = display_name(&project_path);
    let info = ProjectInfo {
        path: project_path.to_string_lossy().to_string(),
        name: name.clone(),
    };

    let recent = RecentProject {
        path: info.path.clone(),
        name,
        last_opened_ms: now_ms(),
    };
    upsert_recent(&state, recent)?;
    persist_recents(&app, &state)?;

    Ok(info)
}

#[tauri::command]
pub fn project_recent(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<RecentProject>, String> {
    load_recents(&app, &state)?;
    Ok(state
        .recents
        .lock()
        .map_err(|_| "recent project lock poisoned".to_string())?
        .clone())
}

#[tauri::command]
pub async fn fs_list(path: String) -> Result<Vec<DirEntryInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = canonical_dir(&path)?;
        let mut entries = Vec::new();

        for item in
            fs::read_dir(&dir).map_err(|err| format!("failed to list {}: {err}", dir.display()))?
        {
            let item = item.map_err(|err| err.to_string())?;
            let path = item.path();
            let file_name = item.file_name().to_string_lossy().to_string();
            if should_hide(&file_name) {
                continue;
            }
            let metadata = item.metadata().map_err(|err| err.to_string())?;
            let kind = if metadata.is_dir() {
                EntryKind::Directory
            } else {
                EntryKind::File
            };
            entries.push(DirEntryInfo {
                path: path.to_string_lossy().to_string(),
                name: file_name,
                kind,
            });
        }

        entries.sort_by(|a, b| match (&a.kind, &b.kind) {
            (EntryKind::Directory, EntryKind::File) => std::cmp::Ordering::Less,
            (EntryKind::File, EntryKind::Directory) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        });

        Ok(entries)
    })
    .await
    .map_err(|err| format!("file listing task failed: {err}"))?
}

const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
const LONG_LINE_CHARS: usize = 10_000;

#[tauri::command]
pub async fn fs_read(path: String) -> Result<FileReadResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = canonical_file(&path)?;
        let metadata = fs::metadata(&path).map_err(|err| format!("failed to stat file: {err}"))?;
        let truncated = metadata.len() > MAX_FILE_BYTES;
        let bytes = if truncated {
            fs::read(&path)
                .map_err(|err| format!("failed to read file: {err}"))?
                .into_iter()
                .take(MAX_FILE_BYTES as usize)
                .collect::<Vec<_>>()
        } else {
            fs::read(&path).map_err(|err| format!("failed to read file: {err}"))?
        };
        let content =
            String::from_utf8(bytes).map_err(|_| "file is not valid UTF-8".to_string())?;
        let long_lines = has_long_line(&content);
        let degrade = truncated || long_lines;
        Ok(FileReadResult {
            path: path.to_string_lossy().to_string(),
            hash: hash_text(&content),
            content,
            truncated,
            long_lines,
            read_only: metadata.permissions().readonly() || degrade,
        })
    })
    .await
    .map_err(|err| format!("file read task failed: {err}"))?
}

#[tauri::command]
pub async fn fs_write(
    app: AppHandle,
    engine: State<'_, Arc<CheckpointEngine>>,
    path: String,
    content: String,
    expected_hash: Option<String>,
) -> Result<FileWriteResult, String> {
    let engine = Arc::clone(engine.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let path = canonical_write_target(&path)?;
        // L1 preimage: capture disk bytes before the first agent/editor write in an active turn.
        let _ = engine.preimage_for_path(&app, &path);
        if let Some(expected) = expected_hash {
            if path.exists() {
                let current = fs::read_to_string(&path)
                    .map_err(|err| format!("failed to read existing file: {err}"))?;
                let current_hash = hash_text(&current);
                if current_hash != expected {
                    return Err("file changed on disk; reload before saving".to_string());
                }
            }
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| format!("failed to create parent: {err}"))?;
        }
        fs::write(&path, &content).map_err(|err| format!("failed to write file: {err}"))?;
        Ok(FileWriteResult {
            hash: hash_text(&content),
        })
    })
    .await
    .map_err(|err| format!("file write task failed: {err}"))?
}

#[tauri::command]
pub fn fs_watch_start(
    state: State<'_, AppState>,
    path: String,
    channel: Channel<FsEvent>,
) -> Result<u64, String> {
    let dir = canonical_dir(&path)?;
    let watcher_id = state
        .next_watcher_id
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        + 1;

    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| match result {
            Ok(event) => {
                let _ = channel.send(FsEvent {
                    watcher_id,
                    kind: format!("{:?}", event.kind),
                    paths: event
                        .paths
                        .into_iter()
                        .map(|path| path.to_string_lossy().to_string())
                        .collect(),
                });
            }
            Err(err) => {
                let _ = channel.send(FsEvent {
                    watcher_id,
                    kind: format!("error:{err}"),
                    paths: Vec::new(),
                });
            }
        },
        Config::default(),
    )
    .map_err(|err| format!("failed to create watcher: {err}"))?;

    watcher
        .watch(&dir, RecursiveMode::Recursive)
        .map_err(|err| format!("failed to watch {}: {err}", dir.display()))?;

    state
        .watchers
        .lock()
        .map_err(|_| "watcher lock poisoned".to_string())?
        .insert(watcher_id, watcher);

    Ok(watcher_id)
}

#[tauri::command]
pub fn fs_watch_stop(state: State<'_, AppState>, watcher_id: u64) -> Result<(), String> {
    state
        .watchers
        .lock()
        .map_err(|_| "watcher lock poisoned".to_string())?
        .remove(&watcher_id);
    Ok(())
}

fn hash_text(text: &str) -> String {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn has_long_line(content: &str) -> bool {
    content
        .lines()
        .any(|line| line.chars().count() > LONG_LINE_CHARS)
}

fn canonical_dir(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    let canonical = path
        .canonicalize()
        .map_err(|err| format!("failed to resolve directory: {err}"))?;
    if !canonical.is_dir() {
        return Err(format!("{} is not a directory", canonical.display()));
    }
    Ok(canonical)
}

fn canonical_file(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    let canonical = path
        .canonicalize()
        .map_err(|err| format!("failed to resolve file: {err}"))?;
    if !canonical.is_file() {
        return Err(format!("{} is not a file", canonical.display()));
    }
    Ok(canonical)
}

fn canonical_write_target(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if path.exists() {
        return canonical_file(path.to_string_lossy().as_ref());
    }
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            return Err(format!(
                "parent directory does not exist: {}",
                parent.display()
            ));
        }
    }
    Ok(path)
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn should_hide(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | ".vite" | ".DS_Store" | "Thumbs.db"
    )
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as f64)
        .unwrap_or_default()
}

fn upsert_recent(state: &State<'_, AppState>, recent: RecentProject) -> Result<(), String> {
    let mut recents = state
        .recents
        .lock()
        .map_err(|_| "recent project lock poisoned".to_string())?;
    recents.retain(|item| item.path != recent.path);
    recents.insert(0, recent);
    recents.truncate(12);
    Ok(())
}

fn recent_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("failed to resolve app config dir: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("failed to create config dir: {err}"))?;
    Ok(dir.join("recents.json"))
}

fn load_recents(app: &AppHandle, state: &State<'_, AppState>) -> Result<(), String> {
    let path = recent_path(app)?;
    if !path.exists() {
        return Ok(());
    }
    let data = fs::read_to_string(&path).map_err(|err| format!("failed to read recents: {err}"))?;
    let recents: Vec<RecentProject> = serde_json::from_str(&data).unwrap_or_default();
    *state
        .recents
        .lock()
        .map_err(|_| "recent project lock poisoned".to_string())? = recents;
    Ok(())
}

fn persist_recents(app: &AppHandle, state: &State<'_, AppState>) -> Result<(), String> {
    let path = recent_path(app)?;
    let data = serde_json::to_string_pretty(
        &*state
            .recents
            .lock()
            .map_err(|_| "recent project lock poisoned".to_string())?,
    )
    .map_err(|err| format!("failed to serialize recents: {err}"))?;
    fs::write(path, data).map_err(|err| format!("failed to write recents: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_long_lines() {
        let short = "hello\nworld\n";
        assert!(!has_long_line(short));
        let long = format!("{}\n", "汉".repeat(LONG_LINE_CHARS + 1));
        assert!(has_long_line(&long));
    }
}
