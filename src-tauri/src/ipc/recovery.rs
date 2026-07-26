//! Crash-safe editor hot-exit snapshots.
//!
//! Dirty buffers are stored under the application data directory rather than
//! beside user source files. A snapshot is removed after the frontend restores
//! it or when every buffer has been saved/discarded.

use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use ts_rs::TS;

const MAX_TABS: usize = 100;
const MAX_TAB_BYTES: usize = 10 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES: usize = 30 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/EditorRecoveryTab.ts")]
pub struct EditorRecoveryTab {
    pub path: String,
    pub content: String,
    pub base_hash: String,
    #[serde(default)]
    pub encoding: Option<String>,
    #[serde(default)]
    pub bom: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/EditorRecoverySnapshot.ts")]
pub struct EditorRecoverySnapshot {
    pub project_path: String,
    pub active_path: Option<String>,
    #[ts(type = "number")]
    pub saved_at: u64,
    pub tabs: Vec<EditorRecoveryTab>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn project_key(project_path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    project_path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn canonical_project(project_path: &str) -> Result<String, String> {
    let project = PathBuf::from(project_path)
        .canonicalize()
        .map_err(|err| format!("failed to resolve recovery project: {err}"))?;
    if !project.is_dir() {
        return Err("recovery project is not a directory".into());
    }
    Ok(project.to_string_lossy().into_owned())
}

fn recovery_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data dir: {err}"))?
        .join("recovery");
    fs::create_dir_all(&dir).map_err(|err| format!("failed to create recovery dir: {err}"))?;
    Ok(dir)
}

fn recovery_path(app: &AppHandle, project_path: &str) -> Result<PathBuf, String> {
    Ok(recovery_root(app)?.join(format!("{}.json", project_key(project_path))))
}

fn validate_snapshot(snapshot: &EditorRecoverySnapshot) -> Result<(), String> {
    if snapshot.project_path.trim().is_empty() {
        return Err("recovery project path is empty".into());
    }
    if snapshot.tabs.len() > MAX_TABS {
        return Err(format!("recovery snapshot exceeds {MAX_TABS} tabs"));
    }
    let mut total = 0usize;
    for tab in &snapshot.tabs {
        if tab.path.trim().is_empty() {
            return Err("recovery tab path is empty".into());
        }
        let bytes = tab.content.len();
        if bytes > MAX_TAB_BYTES {
            return Err(format!(
                "recovery tab exceeds {MAX_TAB_BYTES} bytes: {}",
                tab.path
            ));
        }
        total = total.saturating_add(bytes);
    }
    if total > MAX_SNAPSHOT_BYTES {
        return Err(format!(
            "recovery snapshot exceeds {MAX_SNAPSHOT_BYTES} bytes"
        ));
    }
    Ok(())
}

fn write_snapshot(path: &Path, snapshot: &EditorRecoverySnapshot) -> Result<(), String> {
    let data = serde_json::to_vec(snapshot)
        .map_err(|err| format!("failed to serialize recovery snapshot: {err}"))?;
    let temp = path.with_extension(format!("json.tmp-{}", uuid::Uuid::new_v4()));
    fs::write(&temp, data).map_err(|err| format!("failed to write recovery snapshot: {err}"))?;

    if let Err(first_err) = fs::rename(&temp, path) {
        if path.exists() {
            fs::remove_file(path)
                .map_err(|err| format!("failed to replace recovery snapshot: {err}"))?;
            fs::rename(&temp, path)
                .map_err(|err| format!("failed to install recovery snapshot: {err}"))?;
        } else {
            let _ = fs::remove_file(&temp);
            return Err(format!("failed to install recovery snapshot: {first_err}"));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn editor_recovery_save(
    app: AppHandle,
    mut snapshot: EditorRecoverySnapshot,
) -> Result<(), String> {
    validate_snapshot(&snapshot)?;
    snapshot.project_path = canonical_project(&snapshot.project_path)?;
    snapshot.saved_at = now_ms();
    let path = recovery_path(&app, &snapshot.project_path)?;
    tauri::async_runtime::spawn_blocking(move || write_snapshot(&path, &snapshot))
        .await
        .map_err(|err| format!("recovery save task failed: {err}"))?
}

#[tauri::command]
pub async fn editor_recovery_load(
    app: AppHandle,
    project_path: String,
) -> Result<Option<EditorRecoverySnapshot>, String> {
    let project_path = canonical_project(&project_path)?;
    let path = recovery_path(&app, &project_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        if !path.exists() {
            return Ok(None);
        }
        let data =
            fs::read(&path).map_err(|err| format!("failed to read recovery snapshot: {err}"))?;
        let snapshot: EditorRecoverySnapshot = serde_json::from_slice(&data)
            .map_err(|err| format!("invalid recovery snapshot: {err}"))?;
        validate_snapshot(&snapshot)?;
        if snapshot.project_path != project_path {
            return Err("recovery snapshot project mismatch".into());
        }
        Ok(Some(snapshot))
    })
    .await
    .map_err(|err| format!("recovery load task failed: {err}"))?
}

#[tauri::command]
pub async fn editor_recovery_clear(app: AppHandle, project_path: String) -> Result<(), String> {
    let project_path = canonical_project(&project_path)?;
    let path = recovery_path(&app, &project_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        if path.exists() {
            fs::remove_file(path)
                .map_err(|err| format!("failed to remove recovery snapshot: {err}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|err| format!("recovery clear task failed: {err}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot() -> EditorRecoverySnapshot {
        EditorRecoverySnapshot {
            project_path: "/tmp/project".into(),
            active_path: Some("/tmp/project/src/main.ts".into()),
            saved_at: 42,
            tabs: vec![EditorRecoveryTab {
                path: "/tmp/project/src/main.ts".into(),
                content: "const dirty = true;\n".into(),
                base_hash: "abc".into(),
                encoding: Some("UTF-8".into()),
                bom: Some(false),
            }],
        }
    }

    #[test]
    fn snapshot_roundtrips_through_disk() {
        let dir =
            std::env::temp_dir().join(format!("glyphra-recovery-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("snapshot.json");
        let expected = snapshot();

        validate_snapshot(&expected).unwrap();
        write_snapshot(&path, &expected).unwrap();
        let actual: EditorRecoverySnapshot =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(actual, expected);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rejects_empty_paths_and_oversized_tabs() {
        let mut invalid = snapshot();
        invalid.tabs[0].path.clear();
        assert!(validate_snapshot(&invalid).is_err());

        invalid = snapshot();
        invalid.tabs[0].content = "x".repeat(MAX_TAB_BYTES + 1);
        assert!(validate_snapshot(&invalid).is_err());
    }
}
