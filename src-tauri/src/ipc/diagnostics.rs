use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Manager};
use ts_rs::TS;

use std::sync::Arc;

use tauri::State;

use crate::{
    agent::supervisor::AgentSupervisor, agent_terminal::AgentTerminalManager, lsp::LspManager,
    pty::PtyManager, search::SearchManager,
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use crate::{perf, process_ext::std_command};

const MAX_LOG_FILES: usize = 12;
const MAX_LOG_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_BUNDLE_LOG_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/DiagnosticInfo.ts")]
pub struct DiagnosticInfo {
    pub log_dir: String,
    pub panic_log: String,
    pub bundle_dir: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/DiagnosticBundle.ts")]
pub struct DiagnosticBundle {
    pub path: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/ResourceCounts.ts")]
pub struct ResourceCounts {
    pub agents: usize,
    pub agent_terminals: usize,
    pub ptys: usize,
    pub searches: usize,
    pub language_servers: usize,
}

#[tauri::command]
pub async fn diagnostics_resource_counts(
    supervisor: State<'_, Arc<AgentSupervisor>>,
    terminals: State<'_, Arc<AgentTerminalManager>>,
    ptys: State<'_, Arc<PtyManager>>,
    searches: State<'_, Arc<SearchManager>>,
    language_servers: State<'_, Arc<LspManager>>,
) -> Result<ResourceCounts, String> {
    Ok(ResourceCounts {
        agents: supervisor.live_count().await,
        agent_terminals: terminals.session_count(),
        ptys: ptys.live_count()?,
        searches: searches.live_count()?,
        language_servers: language_servers.live_count().await,
    })
}

#[tauri::command]
pub fn diagnostics_fault_panic(token: String) -> Result<(), String> {
    if token != "GLYPHRA_FAULT_DRILL" {
        return Err("invalid fault-drill token".into());
    }
    #[cfg(debug_assertions)]
    panic!("intentional Glyphra Rust panic fault drill");
    #[cfg(not(debug_assertions))]
    Err("Rust panic drill is disabled in release builds".into())
}

fn diagnostic_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .unwrap_or_else(|_| perf::fallback_log_dir());
    let bundle_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data directory: {err}"))?
        .join("diagnostics");
    Ok((log_dir, bundle_dir))
}

#[tauri::command]
pub fn diagnostics_info(app: AppHandle) -> Result<DiagnosticInfo, String> {
    let (log_dir, bundle_dir) = diagnostic_paths(&app)?;
    Ok(DiagnosticInfo {
        panic_log: log_dir.join("panic.log").to_string_lossy().into_owned(),
        log_dir: log_dir.to_string_lossy().into_owned(),
        bundle_dir: bundle_dir.to_string_lossy().into_owned(),
    })
}

fn log_candidates(log_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(log_dir) else {
        return Vec::new();
    };
    let mut files = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name == "panic.log" || name.starts_with("glyphra.log"))
        })
        .collect::<Vec<_>>();
    files.sort_by_key(|path| {
        std::cmp::Reverse(
            fs::metadata(path)
                .and_then(|metadata| metadata.modified())
                .unwrap_or(UNIX_EPOCH),
        )
    });
    files.truncate(MAX_LOG_FILES);
    files
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path)
        .map_err(|err| format!("failed to open diagnostic file {}: {err}", path.display()))?;
    let mut bytes = Vec::new();
    file.take(limit)
        .read_to_end(&mut bytes)
        .map_err(|err| format!("failed to read diagnostic file {}: {err}", path.display()))?;
    Ok(bytes)
}

fn create_bundle_at(output: &Path, log_dir: &Path, version: &str) -> Result<Vec<String>, String> {
    let parent = output
        .parent()
        .ok_or_else(|| "diagnostic bundle path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|err| format!("failed to create diagnostic bundle directory: {err}"))?;
    let file = fs::File::create(output)
        .map_err(|err| format!("failed to create diagnostic bundle: {err}"))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let system = format!(
        "Glyphra {version}\nos={}\narch={}\ncreated={}\n",
        std::env::consts::OS,
        std::env::consts::ARCH,
        now_seconds()
    );
    zip.start_file("system.txt", options)
        .map_err(|err| format!("failed to start diagnostic metadata: {err}"))?;
    zip.write_all(system.as_bytes())
        .map_err(|err| format!("failed to write diagnostic metadata: {err}"))?;
    let mut included = vec!["system.txt".to_string()];
    let mut total = 0_u64;
    for (index, path) in log_candidates(log_dir).into_iter().enumerate() {
        if total >= MAX_BUNDLE_LOG_BYTES {
            break;
        }
        let remaining = MAX_BUNDLE_LOG_BYTES.saturating_sub(total);
        let limit = remaining.min(MAX_LOG_FILE_BYTES);
        let bytes = read_bounded(&path, limit)?;
        total = total.saturating_add(bytes.len() as u64);
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("glyphra.log");
        let archive_name = format!("logs/{index:02}-{name}");
        zip.start_file(&archive_name, options)
            .map_err(|err| format!("failed to add {archive_name}: {err}"))?;
        zip.write_all(&bytes)
            .map_err(|err| format!("failed to write {archive_name}: {err}"))?;
        included.push(archive_name);
    }
    zip.finish()
        .map_err(|err| format!("failed to finish diagnostic bundle: {err}"))?;
    Ok(included)
}

#[tauri::command]
pub async fn diagnostics_create_bundle(app: AppHandle) -> Result<DiagnosticBundle, String> {
    let (log_dir, bundle_dir) = diagnostic_paths(&app)?;
    let version = app.package_info().version.to_string();
    let output = bundle_dir.join(format!(
        "glyphra-diagnostics-{}-{}.zip",
        now_seconds(),
        uuid::Uuid::new_v4().simple()
    ));
    tauri::async_runtime::spawn_blocking(move || {
        let files = create_bundle_at(&output, &log_dir, &version)?;
        Ok(DiagnosticBundle {
            path: output.to_string_lossy().into_owned(),
            files,
        })
    })
    .await
    .map_err(|err| format!("diagnostic bundle task failed: {err}"))?
}

#[tauri::command]
pub fn diagnostics_reveal_logs(app: AppHandle) -> Result<(), String> {
    let (log_dir, _) = diagnostic_paths(&app)?;
    fs::create_dir_all(&log_dir).map_err(|err| format!("failed to create log directory: {err}"))?;
    #[cfg(target_os = "windows")]
    let mut command = std_command("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = std_command("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = std_command("xdg-open");
    command
        .arg(&log_dir)
        .spawn()
        .map_err(|err| format!("failed to reveal log directory: {err}"))?;
    Ok(())
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_bundle_contains_metadata_and_bounded_logs() {
        let root =
            std::env::temp_dir().join(format!("glyphra-diagnostic-test-{}", uuid::Uuid::new_v4()));
        let logs = root.join("logs");
        fs::create_dir_all(&logs).unwrap();
        fs::write(logs.join("glyphra.log.2026-07-24"), b"hello log").unwrap();
        fs::write(logs.join("unrelated.txt"), b"do not include").unwrap();
        let output = root.join("bundle.zip");

        let files = create_bundle_at(&output, &logs, "test").unwrap();
        assert!(output.is_file());
        assert_eq!(files[0], "system.txt");
        assert_eq!(files.len(), 2);
        assert!(files[1].contains("glyphra.log"));
        let _ = fs::remove_dir_all(root);
    }
}
