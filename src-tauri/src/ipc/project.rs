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
    /// Decoded with replacement characters; saving would destroy the original
    /// bytes, so the frontend opens the buffer read-only.
    pub lossy: bool,
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
            // Stream only the preview window instead of materializing the
            // whole file (which can be gigabytes) just to cut it down.
            let mut bytes = Vec::with_capacity(MAX_FILE_BYTES as usize);
            fs::File::open(&path)
                .map_err(|err| format!("failed to open file: {err}"))?
                .take(MAX_FILE_BYTES)
                .read_to_end(&mut bytes)
                .map_err(|err| format!("failed to read file: {err}"))?;
            bytes
        } else {
            fs::read(&path).map_err(|err| format!("failed to read file: {err}"))?
        };
        let decoded = decode_text(&bytes, encoding.as_deref())?;
        let long_lines = has_long_line(&decoded.content);
        let degrade = truncated || long_lines || decoded.lossy;
        Ok(FileReadResult {
            path: path.to_string_lossy().to_string(),
            hash: hash_bytes(&bytes),
            content: decoded.content,
            truncated,
            long_lines,
            read_only: metadata.permissions().readonly() || degrade,
            lossy: decoded.lossy,
            encoding: decoded.encoding,
            bom: decoded.bom,
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
        write_atomic(&path, &bytes)?;
        Ok(FileWriteResult {
            hash: hash_bytes(&bytes),
        })
    })
    .await
    .map_err(|err| format!("file write task failed: {err}"))?
}

/// Directories never worth watching. Recursive watchers register one OS watch
/// handle per directory, so a project with tens of thousands of subdirectories
/// (game assets, build trees) can exhaust system handle capacity and freeze the
/// machine — prune these names and cap registration outright.
const WATCH_PRUNE_DIRS: [&str; 10] = [
    ".git",
    "node_modules",
    "target",
    "dist",
    ".vite",
    "bin",
    "build",
    "obj",
    "out",
    "logs",
];
/// Registration is not free memory: `notify`'s Windows backend keeps one
/// `ReadDirectoryChangesW` request per watched directory, each holding a 16 KiB
/// buffer plus a directory handle, a semaphore and an OVERLAPPED — roughly
/// 16 MiB and 4 000 kernel handles per 1 000 directories, *per workspace root*.
/// The explorer only needs the root and the levels near it, and breadth-first
/// collection puts those first, so cap the registration low enough that a
/// multi-root workspace over an asset tree stays affordable.
const MAX_WATCH_DIRS: usize = 2_048;

/// Bounded breadth-first collection of directories to watch (root first, then
/// shallow directories before deep ones). Pruned names are skipped and the
/// total count is capped so registration cost stays proportional to the UI's
/// needs instead of the tree's size.
fn collect_watch_dirs(root: &std::path::Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut queue = std::collections::VecDeque::from([root.to_path_buf()]);
    while let Some(dir) = queue.pop_front() {
        if dirs.len() >= MAX_WATCH_DIRS {
            break;
        }
        dirs.push(dir.clone());
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if dirs.len() >= MAX_WATCH_DIRS {
                break;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if WATCH_PRUNE_DIRS.iter().any(|pruned| name == *pruned) {
                continue;
            }
            queue.push_back(entry.path());
        }
    }
    dirs
}

/// Directory walk + watch registration for one root. Sync, and slow enough on a
/// cold tree (one `read_dir` and one OS watch per directory) that it must never
/// run on the thread that serves the UI.
fn build_watcher(
    path: String,
    channel: Channel<FsEvent>,
    watcher_id: u64,
) -> Result<RecommendedWatcher, String> {
    let requested = PathBuf::from(&path)
        .canonicalize()
        .map_err(|err| format!("failed to resolve watch path: {err}"))?;
    let requested = crate::paths::simplified(&requested);
    let (watch_dirs, file_filter) = if requested.is_dir() {
        (collect_watch_dirs(&requested), None)
    } else if requested.is_file() {
        let parent = requested
            .parent()
            .ok_or_else(|| format!("{} has no parent directory", requested.display()))?
            .to_path_buf();
        (vec![parent], Some(requested))
    } else {
        return Err(format!(
            "{} is not a file or directory",
            requested.display()
        ));
    };

    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| match result {
            Ok(event) => {
                let paths = event
                    .paths
                    .into_iter()
                    .map(|path| crate::paths::simplified(&path))
                    .filter(|path| file_filter.as_ref().is_none_or(|expected| path == expected))
                    .map(|path| path.to_string_lossy().to_string())
                    .collect::<Vec<_>>();
                if paths.is_empty() {
                    return;
                }
                let _ = channel.send(FsEvent {
                    watcher_id,
                    kind: format!("{:?}", event.kind),
                    paths,
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

    // One handle per directory on Windows: register each directory explicitly
    // instead of a single recursive watch so pruned trees stay unwatched.
    for dir in &watch_dirs {
        if let Err(err) = watcher.watch(dir, RecursiveMode::NonRecursive) {
            tracing::debug!(target: "fs-watch", %err, "skip unwatchable dir {}", dir.display());
        }
    }

    Ok(watcher)
}

#[tauri::command]
pub async fn fs_watch_start(
    state: State<'_, AppState>,
    path: String,
    channel: Channel<FsEvent>,
) -> Result<u64, String> {
    let watcher_id = state
        .next_watcher_id
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        + 1;
    let watcher =
        tauri::async_runtime::spawn_blocking(move || build_watcher(path, channel, watcher_id))
            .await
            .map_err(|err| format!("watch task failed: {err}"))??;

    state
        .watchers
        .lock()
        .map_err(|_| "watcher lock poisoned".to_string())?
        .insert(watcher_id, watcher);

    Ok(watcher_id)
}

#[tauri::command]
pub fn fs_watch_stop(state: State<'_, AppState>, watcher_id: u64) -> Result<(), String> {
    let watcher = state
        .watchers
        .lock()
        .map_err(|_| "watcher lock poisoned".to_string())?
        .remove(&watcher_id);
    // Dropping the watcher cancels and joins one pending OS read per watched
    // directory. Doing that inline would stall the UI thread for as long as
    // registration did, so hand the teardown to the blocking pool.
    if let Some(watcher) = watcher {
        tauri::async_runtime::spawn_blocking(move || drop(watcher));
    }
    Ok(())
}

/// Write-then-rename so a crash or power loss mid-save leaves either the old
/// file or the new file on disk — never a truncated hybrid. `fs::rename`
/// replaces existing files on every supported platform (MoveFileEx with
/// MOVEFILE_REPLACE_EXISTING on Windows).
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;

    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("invalid write target: {}", path.display()))?
        .to_string_lossy()
        .into_owned();
    let temp = parent.join(format!(".{file_name}.glyphra-{}.tmp", std::process::id()));

    let result = (|| {
        let mut file = fs::File::create(&temp)
            .map_err(|err| format!("failed to create temporary file: {err}"))?;
        file.write_all(bytes)
            .map_err(|err| format!("failed to write file: {err}"))?;
        // Flush to the platter before the rename makes the write visible.
        file.sync_all()
            .map_err(|err| format!("failed to flush file: {err}"))?;
        drop(file);
        fs::rename(&temp, path).map_err(|err| format!("failed to replace file: {err}"))
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
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

pub(crate) struct DecodedText {
    pub content: String,
    pub encoding: String,
    pub bom: bool,
    /// Invalid byte sequences were replaced with U+FFFD. The text is safe to
    /// display but must never be written back over the original file.
    pub lossy: bool,
}

pub(crate) fn decode_text(bytes: &[u8], requested: Option<&str>) -> Result<DecodedText, String> {
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
    // Decode errors degrade to replacement characters instead of refusing to
    // open the file: a stray byte in a log or mixed-encoding source must not
    // make the whole document unopenable.
    let (decoded, had_errors) = encoding.decode_without_bom_handling(&bytes[skip..]);
    Ok(DecodedText {
        content: decoded.into_owned(),
        encoding: encoding.name().to_string(),
        bom,
        lossy: had_errors,
    })
}

pub(crate) fn encode_text(
    content: &str,
    label: Option<&str>,
    bom: bool,
) -> Result<Vec<u8>, String> {
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
        let legacy = decode_text(b"caf\xe9", Some("windows-1252")).expect("decode windows-1252");
        assert_eq!(legacy.content, "café");
        assert_eq!(legacy.encoding, "windows-1252");
        assert!(!legacy.bom);
        assert!(!legacy.lossy);

        let bytes = encode_text("hello 世界", Some("UTF-16LE"), true).expect("encode utf16");
        assert!(bytes.starts_with(b"\xff\xfe"));
        let decoded = decode_text(&bytes, None).expect("detect utf16");
        assert_eq!(decoded.content, "hello 世界");
        assert_eq!(decoded.encoding, "UTF-16LE");
        assert!(decoded.bom);
        assert!(!decoded.lossy);

        assert!(encode_text("世界", Some("windows-1252"), false).is_err());
    }

    #[test]
    fn invalid_byte_sequences_decode_lossily_instead_of_failing() {
        // An explicit UTF-8 read of bytes that are not valid UTF-8 must still
        // produce displayable text, flagged as lossy so saves are blocked.
        let decoded = decode_text(b"ok \xff\xfe\xfa bytes", Some("UTF-8")).expect("lossy decode");
        assert!(decoded.lossy);
        assert!(decoded.content.contains('\u{FFFD}'));
        assert!(decoded.content.starts_with("ok "));
    }

    #[test]
    fn atomic_write_replaces_existing_content_and_cleans_up_temp_files() {
        let dir = std::env::temp_dir().join(format!("glyphra-write-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("file.txt");

        write_atomic(&target, b"first").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"first");
        write_atomic(&target, b"second, longer contents").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"second, longer contents");

        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left behind: {leftovers:?}");

        let _ = fs::remove_dir_all(&dir);
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

    #[test]
    fn watch_dirs_prune_heavy_trees_and_keep_the_root() {
        let root = std::env::temp_dir().join(format!("glyphra-watch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src/deep")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::create_dir_all(root.join(".git/objects")).unwrap();
        std::fs::create_dir_all(root.join("bin")).unwrap();
        std::fs::create_dir_all(root.join("resources/tex")).unwrap();

        let dirs = collect_watch_dirs(&root);
        let names: Vec<String> = dirs
            .iter()
            .filter_map(|dir| dir.strip_prefix(&root).ok())
            .map(|dir| dir.to_string_lossy().replace('\\', "/"))
            .collect();

        assert!(names.contains(&"".to_string()), "{names:?}");
        assert!(names.contains(&"src".to_string()), "{names:?}");
        assert!(names.contains(&"src/deep".to_string()), "{names:?}");
        assert!(names.contains(&"resources/tex".to_string()), "{names:?}");
        assert!(
            !names.iter().any(|n| n.contains("node_modules")),
            "{names:?}"
        );
        assert!(!names.iter().any(|n| n.starts_with(".git")), "{names:?}");
        assert!(!names.iter().any(|n| n.starts_with("bin")), "{names:?}");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn watch_dirs_respect_the_registration_cap() {
        let root = std::env::temp_dir().join(format!("glyphra-watch-cap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        // 6_000 directories against a 2_048 cap: registration must stop at the
        // cap instead of scaling with the tree (each watch costs ~16 KiB and
        // two kernel handles).
        for index in 0..3_000 {
            std::fs::create_dir_all(root.join(format!("d{index}/leaf"))).unwrap();
        }
        let dirs = collect_watch_dirs(&root);
        assert_eq!(dirs.len(), MAX_WATCH_DIRS, "{} dirs registered", dirs.len());
        // Breadth-first: the root and its immediate children win the budget, so
        // the explorer's visible levels stay watched.
        assert_eq!(dirs[0], root);
        assert!(
            dirs.iter().all(|dir| dir.strip_prefix(&root).is_ok()),
            "watch set escaped the root"
        );

        let _ = std::fs::remove_dir_all(&root);
    }
}
