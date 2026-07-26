use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    io::Read,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use std::sync::Arc;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chardetng::EncodingDetector;
use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};
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
    pub long_lines: bool,
    pub read_only: bool,
    pub encoding: String,
    pub bom: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/FileWriteResult.ts")]
pub struct FileWriteResult {
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/MediaPreviewResult.ts")]
pub struct MediaPreviewResult {
    pub path: String,
    pub kind: String,
    pub mime: String,
    #[ts(type = "number")]
    pub size: u64,
    pub data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/ProjectSymbol.ts")]
pub struct ProjectSymbol {
    pub name: String,
    pub kind: String,
    pub path: String,
    pub line: u32,
    pub signature: String,
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
const MAX_MEDIA_PREVIEW_BYTES: u64 = 25 * 1024 * 1024;
const BINARY_SAMPLE_BYTES: usize = 8 * 1024;
const MAX_SYMBOL_FILE_BYTES: u64 = 512 * 1024;
const MAX_SYMBOL_SCAN_BYTES: u64 = 32 * 1024 * 1024;
const MAX_SYMBOL_PATHS: usize = 20_000;
const MAX_PROJECT_SYMBOLS: usize = 20_000;

#[tauri::command]
pub async fn project_symbols(
    project_path: String,
    paths: Vec<String>,
) -> Result<Vec<ProjectSymbol>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = canonical_dir(&project_path)?;
        let mut symbols = Vec::new();
        let mut scanned_bytes = 0_u64;

        for relative in paths.into_iter().take(MAX_SYMBOL_PATHS) {
            if symbols.len() >= MAX_PROJECT_SYMBOLS || scanned_bytes >= MAX_SYMBOL_SCAN_BYTES {
                break;
            }
            if !is_symbol_source(&relative) {
                continue;
            }
            let candidate = root.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR));
            let Ok(path) = candidate.canonicalize() else {
                continue;
            };
            if !path.starts_with(&root) || !path.is_file() {
                continue;
            }
            let Ok(metadata) = fs::metadata(&path) else {
                continue;
            };
            if metadata.len() > MAX_SYMBOL_FILE_BYTES
                || scanned_bytes.saturating_add(metadata.len()) > MAX_SYMBOL_SCAN_BYTES
            {
                continue;
            }
            let Ok(content) = fs::read_to_string(&path) else {
                continue;
            };
            scanned_bytes = scanned_bytes.saturating_add(metadata.len());
            let normalized = path
                .strip_prefix(&root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            extract_symbols(&content, &normalized, &mut symbols);
        }

        symbols.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then_with(|| a.path.cmp(&b.path))
                .then_with(|| a.line.cmp(&b.line))
        });
        symbols.dedup_by(|a, b| a.name == b.name && a.path == b.path && a.line == b.line);
        symbols.truncate(MAX_PROJECT_SYMBOLS);
        Ok(symbols)
    })
    .await
    .map_err(|err| format!("project symbol task failed: {err}"))?
}

#[tauri::command]
pub async fn fs_media_preview(path: String) -> Result<Option<MediaPreviewResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = canonical_file(&path)?;
        let metadata = fs::metadata(&path).map_err(|err| format!("failed to stat file: {err}"))?;
        let mut sample = Vec::with_capacity(BINARY_SAMPLE_BYTES);
        fs::File::open(&path)
            .map_err(|err| format!("failed to open file: {err}"))?
            .take(BINARY_SAMPLE_BYTES as u64)
            .read_to_end(&mut sample)
            .map_err(|err| format!("failed to sample file: {err}"))?;
        let Some((kind, mime)) = classify_media(&path, &sample, metadata.len()) else {
            return Ok(None);
        };
        let data_url = if kind != "binary" && metadata.len() <= MAX_MEDIA_PREVIEW_BYTES {
            let bytes = fs::read(&path).map_err(|err| format!("failed to read media: {err}"))?;
            Some(format!("data:{mime};base64,{}", BASE64.encode(bytes)))
        } else {
            None
        };
        Ok(Some(MediaPreviewResult {
            path: path.to_string_lossy().into_owned(),
            kind: kind.into(),
            mime: mime.into(),
            size: metadata.len(),
            data_url,
        }))
    })
    .await
    .map_err(|err| format!("media preview task failed: {err}"))?
}

#[tauri::command]
pub async fn fs_read(path: String) -> Result<FileReadResult, String> {
    fs_read_with_encoding(path, None).await
}

#[tauri::command]
pub async fn fs_read_with_encoding(
    path: String,
    encoding: Option<String>,
) -> Result<FileReadResult, String> {
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
        let (content, detected_encoding, bom) = decode_text(&bytes, encoding.as_deref())?;
        let long_lines = has_long_line(&content);
        let degrade = truncated || long_lines;
        Ok(FileReadResult {
            path: path.to_string_lossy().to_string(),
            hash: hash_bytes(&bytes),
            content,
            truncated,
            long_lines,
            read_only: metadata.permissions().readonly() || degrade,
            encoding: detected_encoding,
            bom,
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
    encoding: Option<String>,
    bom: Option<bool>,
) -> Result<FileWriteResult, String> {
    let engine = Arc::clone(engine.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let path = canonical_write_target(&path)?;
        // L1 preimage: capture disk bytes before the first agent/editor write in an active turn.
        let _ = engine.preimage_for_path(&app, &path);
        if let Some(expected) = expected_hash {
            if path.exists() {
                let current = fs::read(&path)
                    .map_err(|err| format!("failed to read existing file: {err}"))?;
                let current_hash = hash_bytes(&current);
                if current_hash != expected {
                    return Err("file changed on disk; reload before saving".to_string());
                }
            }
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| format!("failed to create parent: {err}"))?;
        }
        let bytes = encode_text(&content, encoding.as_deref(), bom.unwrap_or(false))?;
        fs::write(&path, &bytes).map_err(|err| format!("failed to write file: {err}"))?;
        Ok(FileWriteResult {
            hash: hash_bytes(&bytes),
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

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn encoding_for_label(label: &str) -> Result<&'static Encoding, String> {
    Encoding::for_label(label.trim().as_bytes())
        .ok_or_else(|| format!("unsupported text encoding: {label}"))
}

fn decode_text(bytes: &[u8], requested: Option<&str>) -> Result<(String, String, bool), String> {
    let bom_encoding = Encoding::for_bom(bytes);
    let (encoding, skip, bom) = if let Some(label) = requested {
        (encoding_for_label(label)?, 0, false)
    } else if let Some((encoding, length)) = bom_encoding {
        (encoding, length, true)
    } else if std::str::from_utf8(bytes).is_ok() {
        (UTF_8, 0, false)
    } else {
        let mut detector = EncodingDetector::new();
        detector.feed(bytes, true);
        (detector.guess(None, true), 0, false)
    };
    let (decoded, had_errors) = encoding.decode_without_bom_handling(&bytes[skip..]);
    if had_errors {
        return Err(format!(
            "file contains invalid byte sequences for {}",
            encoding.name()
        ));
    }
    Ok((decoded.into_owned(), encoding.name().to_string(), bom))
}

fn encode_text(content: &str, label: Option<&str>, bom: bool) -> Result<Vec<u8>, String> {
    let encoding = match label {
        Some(value) => encoding_for_label(value)?,
        None => UTF_8,
    };
    if encoding == UTF_16LE || encoding == UTF_16BE {
        let prefix = if bom {
            if encoding == UTF_16LE {
                b"\xFF\xFE".as_slice()
            } else {
                b"\xFE\xFF".as_slice()
            }
        } else {
            &[]
        };
        let mut bytes = Vec::with_capacity(prefix.len() + content.len() * 2);
        bytes.extend_from_slice(prefix);
        for unit in content.encode_utf16() {
            let encoded = if encoding == UTF_16LE {
                unit.to_le_bytes()
            } else {
                unit.to_be_bytes()
            };
            bytes.extend_from_slice(&encoded);
        }
        return Ok(bytes);
    }
    let (encoded, _, had_errors) = encoding.encode(content);
    if had_errors {
        return Err(format!(
            "text contains characters that cannot be represented as {}",
            encoding.name()
        ));
    }
    let prefix: &[u8] = if bom {
        if encoding == UTF_8 {
            b"\xEF\xBB\xBF"
        } else if encoding == UTF_16LE {
            b"\xFF\xFE"
        } else if encoding == UTF_16BE {
            b"\xFE\xFF"
        } else {
            &[]
        }
    } else {
        &[]
    };
    let mut bytes = Vec::with_capacity(prefix.len() + encoded.len());
    bytes.extend_from_slice(prefix);
    bytes.extend_from_slice(&encoded);
    Ok(bytes)
}

fn has_long_line(content: &str) -> bool {
    content
        .lines()
        .any(|line| line.chars().count() > LONG_LINE_CHARS)
}

fn classify_media(
    path: &Path,
    sample: &[u8],
    file_size: u64,
) -> Option<(&'static str, &'static str)> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let known = match extension.as_str() {
        "png" => Some(("image", "image/png")),
        "jpg" | "jpeg" => Some(("image", "image/jpeg")),
        "gif" => Some(("image", "image/gif")),
        "webp" => Some(("image", "image/webp")),
        "bmp" => Some(("image", "image/bmp")),
        "ico" => Some(("image", "image/x-icon")),
        "svg" => Some(("image", "image/svg+xml")),
        "mp3" => Some(("audio", "audio/mpeg")),
        "wav" => Some(("audio", "audio/wav")),
        "ogg" | "oga" => Some(("audio", "audio/ogg")),
        "m4a" => Some(("audio", "audio/mp4")),
        "flac" => Some(("audio", "audio/flac")),
        "mp4" | "m4v" => Some(("video", "video/mp4")),
        "webm" => Some(("video", "video/webm")),
        "ogv" => Some(("video", "video/ogg")),
        "mov" => Some(("video", "video/quicktime")),
        _ => None,
    };
    if known.is_some() {
        return known;
    }

    let magic = if sample.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("image", "image/png"))
    } else if sample.starts_with(b"\xff\xd8\xff") {
        Some(("image", "image/jpeg"))
    } else if sample.starts_with(b"GIF87a") || sample.starts_with(b"GIF89a") {
        Some(("image", "image/gif"))
    } else if sample.len() >= 12 && &sample[..4] == b"RIFF" && &sample[8..12] == b"WEBP" {
        Some(("image", "image/webp"))
    } else {
        None
    };
    if magic.is_some() {
        return magic;
    }

    if Encoding::for_bom(sample).is_some() {
        return None;
    }
    let definitely_binary = sample.contains(&0)
        || std::str::from_utf8(sample).is_err_and(|error| {
            // A partial final UTF-8 codepoint in the sample is still plausibly text.
            error.error_len().is_some() || error.valid_up_to() == 0
        });
    (definitely_binary || (file_size > 0 && sample.is_empty()))
        .then_some(("binary", "application/octet-stream"))
}

fn is_symbol_source(path: &str) -> bool {
    matches!(
        Path::new(path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "c" | "cc"
            | "cpp"
            | "cs"
            | "cxx"
            | "go"
            | "h"
            | "hpp"
            | "java"
            | "js"
            | "jsx"
            | "kt"
            | "kts"
            | "mjs"
            | "mts"
            | "py"
            | "rb"
            | "rs"
            | "swift"
            | "ts"
            | "tsx"
            | "vue"
    )
}

fn clean_symbol_name(value: &str) -> Option<String> {
    let name = value
        .trim_start_matches(|character: char| !character.is_alphabetic() && character != '_')
        .chars()
        .take_while(|character| {
            character.is_alphanumeric() || *character == '_' || *character == '$'
        })
        .collect::<String>();
    (!name.is_empty()).then_some(name)
}

fn declaration_after<'a>(line: &'a str, keyword: &str) -> Option<&'a str> {
    let index = line.find(keyword)?;
    let before = &line[..index];
    if before
        .chars()
        .next_back()
        .is_some_and(|character| character.is_alphanumeric() || character == '_')
    {
        return None;
    }
    Some(&line[index + keyword.len()..])
}

fn symbol_from_line(line: &str) -> Option<(String, &'static str)> {
    let trimmed = line.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("//")
        || trimmed.starts_with('#')
        || trimmed.starts_with('*')
        || trimmed.starts_with("/*")
    {
        return None;
    }
    let indent = line.len().saturating_sub(line.trim_start().len());
    if indent > 8 {
        return None;
    }

    let declarations = [
        ("interface ", "interface"),
        ("namespace ", "namespace"),
        ("trait ", "trait"),
        ("struct ", "struct"),
        ("enum ", "enum"),
        ("class ", "class"),
        ("module ", "module"),
        ("mod ", "module"),
        ("type ", "type"),
        ("function ", "function"),
        ("fn ", "function"),
        ("def ", "function"),
    ];
    for (keyword, kind) in declarations {
        if let Some(rest) = declaration_after(trimmed, keyword) {
            if let Some(name) = clean_symbol_name(rest) {
                return Some((name, kind));
            }
        }
    }

    // Common top-level constants and JavaScript/TypeScript arrow functions.
    for keyword in ["const ", "static ", "let ", "var "] {
        if let Some(rest) = declaration_after(trimmed, keyword) {
            if let Some(name) = clean_symbol_name(rest) {
                let kind = if rest.contains("=>") {
                    "function"
                } else {
                    "constant"
                };
                return Some((name, kind));
            }
        }
    }

    // Go receiver functions: `func (receiver Type) Method(...)`.
    if let Some(rest) = trimmed.strip_prefix("func ") {
        let candidate = if rest.starts_with('(') {
            rest.find(')')
                .map(|index| &rest[index + 1..])
                .unwrap_or(rest)
        } else {
            rest
        };
        if let Some(name) = clean_symbol_name(candidate) {
            return Some((name, "function"));
        }
    }
    None
}

fn extract_symbols(content: &str, path: &str, output: &mut Vec<ProjectSymbol>) {
    for (index, line) in content.lines().enumerate() {
        if output.len() >= MAX_PROJECT_SYMBOLS {
            break;
        }
        let Some((name, kind)) = symbol_from_line(line) else {
            continue;
        };
        let mut signature = line.trim().chars().take(240).collect::<String>();
        if line.trim().chars().count() > 240 {
            signature.push('…');
        }
        output.push(ProjectSymbol {
            name,
            kind: kind.into(),
            path: path.into(),
            line: index.saturating_add(1) as u32,
            signature,
        });
    }
}

/// `canonicalize` returns extended-length (`\\?\`) paths on Windows. They are
/// valid for Rust, but every project path here is later handed to the frontend,
/// to harnesses as a working directory, and to CLIs like git and node — none of
/// which cope with the prefix — so normalize it away at the source.
fn canonical_dir(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    let canonical = path
        .canonicalize()
        .map_err(|err| format!("failed to resolve directory: {err}"))?;
    if !canonical.is_dir() {
        return Err(format!("{} is not a directory", canonical.display()));
    }
    Ok(crate::paths::simplified(&canonical))
}

fn canonical_file(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    let canonical = path
        .canonicalize()
        .map_err(|err| format!("failed to resolve file: {err}"))?;
    if !canonical.is_file() {
        return Err(format!("{} is not a file", canonical.display()));
    }
    Ok(crate::paths::simplified(&canonical))
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
    let stored: Vec<RecentProject> = serde_json::from_str(&data).unwrap_or_default();
    // Lists written before paths were normalized can hold both `\\?\D:\p` and
    // `D:\p` for one project. Collapse them so the same folder is listed once.
    let mut seen = std::collections::HashSet::new();
    let recents = stored
        .into_iter()
        .map(|mut entry| {
            entry.path = crate::paths::simplified_str(&entry.path);
            entry
        })
        .filter(|entry| seen.insert(entry.path.clone()))
        .collect::<Vec<_>>();
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

    #[test]
    fn classifies_known_media_and_binary_content() {
        assert_eq!(
            classify_media(Path::new("photo.png"), b"not-even-png", 12),
            Some(("image", "image/png"))
        );
        assert_eq!(
            classify_media(Path::new("renamed.bin"), b"\x89PNG\r\n\x1a\n", 8),
            Some(("image", "image/png"))
        );
        assert_eq!(
            classify_media(Path::new("archive.bin"), b"abc\0def", 7),
            Some(("binary", "application/octet-stream"))
        );
        assert_eq!(
            classify_media(Path::new("source.rs"), b"fn main() {}\n", 13),
            None
        );
        assert_eq!(
            classify_media(Path::new("utf16.txt"), b"\xff\xfeh\0i\0", 6),
            None
        );
    }

    #[test]
    fn decodes_selected_legacy_encoding_and_roundtrips_utf16_bom() {
        let (legacy, encoding, bom) =
            decode_text(b"caf\xe9", Some("windows-1252")).expect("decode windows-1252");
        assert_eq!(legacy, "café");
        assert_eq!(encoding, "windows-1252");
        assert!(!bom);

        let bytes = encode_text("hello 世界", Some("UTF-16LE"), true).expect("encode utf16");
        assert!(bytes.starts_with(b"\xff\xfe"));
        let (decoded, encoding, bom) = decode_text(&bytes, None).expect("detect utf16");
        assert_eq!(decoded, "hello 世界");
        assert_eq!(encoding, "UTF-16LE");
        assert!(bom);

        assert!(encode_text("世界", Some("windows-1252"), false).is_err());
    }

    #[test]
    fn extracts_lightweight_symbols_across_common_languages() {
        let content = r#"
export class WorkspaceController {}
export async function openProject() {}
pub(crate) struct RecoveryState {}
pub fn restore_snapshot() {}
const hydrateContext = () => {};
    def method(self):
        pass
"#;
        let mut symbols = Vec::new();
        extract_symbols(content, "src/context.ts", &mut symbols);
        let names = symbols
            .iter()
            .map(|symbol| (symbol.name.as_str(), symbol.kind.as_str()))
            .collect::<Vec<_>>();
        assert!(names.contains(&("WorkspaceController", "class")));
        assert!(names.contains(&("openProject", "function")));
        assert!(names.contains(&("RecoveryState", "struct")));
        assert!(names.contains(&("restore_snapshot", "function")));
        assert!(names.contains(&("hydrateContext", "function")));
        assert!(names.contains(&("method", "function")));
        assert_eq!(symbols[0].path, "src/context.ts");
    }

    #[test]
    fn recognizes_symbol_source_extensions() {
        assert!(is_symbol_source("src/App.tsx"));
        assert!(is_symbol_source("src/main.rs"));
        assert!(!is_symbol_source("assets/logo.png"));
        assert!(!is_symbol_source("README.md"));
    }
}
