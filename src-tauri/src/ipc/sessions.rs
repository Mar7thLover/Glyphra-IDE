//! Local session archives (JSONL) under the app data dir.
//!
//! Layout:
//!   `{app_data}/sessions/{projectKey}/index.json`
//!   `{app_data}/sessions/{projectKey}/{id}.jsonl`
//!
//! Line 0 is meta; subsequent lines are timeline items. The frontend uses the
//! saved ACP session id for native reload when supported, and the timeline as
//! a continuation-context fallback for other agents.

use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/SessionSummary.ts")]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub backend: String,
    /// Epoch millis (ts-rs: number, not bigint).
    #[ts(type = "number")]
    pub created_at: u64,
    #[ts(type = "number")]
    pub updated_at: u64,
    pub item_count: u32,
    pub acp_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/SessionArchive.ts")]
pub struct SessionArchive {
    pub id: String,
    pub project_path: String,
    pub title: String,
    pub backend: String,
    #[ts(type = "number")]
    pub created_at: u64,
    #[ts(type = "number")]
    pub updated_at: u64,
    pub acp_session_id: Option<String>,
    #[serde(default)]
    pub usage: Option<SessionUsage>,
    #[serde(default)]
    pub cost: Option<SessionCost>,
    // Timeline items as JSON values (shape owned by the frontend).
    #[ts(type = "Array<unknown>")]
    pub items: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/SessionUsage.ts")]
pub struct SessionUsage {
    #[ts(type = "number")]
    pub total_tokens: u64,
    #[ts(type = "number")]
    pub input_tokens: u64,
    #[ts(type = "number")]
    pub output_tokens: u64,
    #[ts(type = "number | null")]
    pub thought_tokens: Option<u64>,
    #[ts(type = "number | null")]
    pub cached_read_tokens: Option<u64>,
    #[ts(type = "number | null")]
    pub cached_write_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/SessionCost.ts")]
pub struct SessionCost {
    pub amount: f64,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetaLine {
    v: u32,
    kind: String,
    id: String,
    project_path: String,
    title: String,
    backend: String,
    created_at: u64,
    updated_at: u64,
    acp_session_id: Option<String>,
    #[serde(default)]
    usage: Option<SessionUsage>,
    #[serde(default)]
    cost: Option<SessionCost>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ItemLine {
    v: u32,
    kind: String,
    item: Value,
}

fn project_key(project_path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    project_path.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn sessions_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve app data dir: {err}"))?
        .join("sessions");
    fs::create_dir_all(&dir).map_err(|err| format!("failed to create sessions dir: {err}"))?;
    Ok(dir)
}

fn project_dir(app: &AppHandle, project_path: &str) -> Result<PathBuf, String> {
    let dir = sessions_root(app)?.join(project_key(project_path));
    fs::create_dir_all(&dir)
        .map_err(|err| format!("failed to create project sessions dir: {err}"))?;
    Ok(dir)
}

fn index_path(dir: &Path) -> PathBuf {
    dir.join("index.json")
}

fn archive_path(dir: &Path, id: &str) -> PathBuf {
    // Sanitize id to a single path segment.
    let safe: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    dir.join(format!("{safe}.jsonl"))
}

fn read_index(dir: &Path) -> Vec<SessionSummary> {
    let path = index_path(dir);
    if !path.exists() {
        return Vec::new();
    }
    let Ok(data) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    serde_json::from_str(&data).unwrap_or_default()
}

fn write_index(dir: &Path, entries: &[SessionSummary]) -> Result<(), String> {
    let data = serde_json::to_string_pretty(entries)
        .map_err(|err| format!("failed to serialize session index: {err}"))?;
    fs::write(index_path(dir), data).map_err(|err| format!("failed to write session index: {err}"))
}

fn write_jsonl(path: &Path, archive: &SessionArchive) -> Result<(), String> {
    let meta = MetaLine {
        v: 1,
        kind: "meta".into(),
        id: archive.id.clone(),
        project_path: archive.project_path.clone(),
        title: archive.title.clone(),
        backend: archive.backend.clone(),
        created_at: archive.created_at,
        updated_at: archive.updated_at,
        acp_session_id: archive.acp_session_id.clone(),
        usage: archive.usage.clone(),
        cost: archive.cost.clone(),
    };
    let mut out = String::new();
    out.push_str(&serde_json::to_string(&meta).map_err(|err| format!("serialize meta: {err}"))?);
    out.push('\n');
    for item in &archive.items {
        let line = ItemLine {
            v: 1,
            kind: "item".into(),
            item: item.clone(),
        };
        out.push_str(
            &serde_json::to_string(&line).map_err(|err| format!("serialize item: {err}"))?,
        );
        out.push('\n');
    }
    fs::write(path, out).map_err(|err| format!("failed to write session archive: {err}"))
}

fn read_jsonl(path: &Path) -> Result<SessionArchive, String> {
    let data =
        fs::read_to_string(path).map_err(|err| format!("failed to read session archive: {err}"))?;
    let mut meta: Option<MetaLine> = None;
    let mut items = Vec::new();
    for (idx, line) in data.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(line)
            .map_err(|err| format!("invalid JSONL line {}: {err}", idx + 1))?;
        let kind = value
            .get("kind")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        match kind {
            "meta" => {
                meta = Some(
                    serde_json::from_value(value)
                        .map_err(|err| format!("invalid meta line: {err}"))?,
                );
            }
            "item" => {
                let item_line: ItemLine = serde_json::from_value(value)
                    .map_err(|err| format!("invalid item line: {err}"))?;
                items.push(item_line.item);
            }
            other => {
                return Err(format!("unknown JSONL kind `{other}` on line {}", idx + 1));
            }
        }
    }
    let meta = meta.ok_or_else(|| "session archive missing meta line".to_string())?;
    Ok(SessionArchive {
        id: meta.id,
        project_path: meta.project_path,
        title: meta.title,
        backend: meta.backend,
        created_at: meta.created_at,
        updated_at: meta.updated_at,
        acp_session_id: meta.acp_session_id,
        usage: meta.usage,
        cost: meta.cost,
        items,
    })
}

#[tauri::command]
pub fn session_list(app: AppHandle, project_path: String) -> Result<Vec<SessionSummary>, String> {
    let dir = project_dir(&app, &project_path)?;
    let mut entries = read_index(&dir);
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.updated_at));
    Ok(entries)
}

#[tauri::command]
pub fn session_save(app: AppHandle, archive: SessionArchive) -> Result<SessionSummary, String> {
    if archive.id.trim().is_empty() {
        return Err("session id is empty".into());
    }
    if archive.project_path.trim().is_empty() {
        return Err("project path is empty".into());
    }
    let dir = project_dir(&app, &archive.project_path)?;
    write_jsonl(&archive_path(&dir, &archive.id), &archive)?;

    let summary = SessionSummary {
        id: archive.id.clone(),
        title: archive.title.clone(),
        backend: archive.backend.clone(),
        created_at: archive.created_at,
        updated_at: archive.updated_at,
        item_count: archive.items.len() as u32,
        acp_session_id: archive.acp_session_id.clone(),
    };

    let mut index = read_index(&dir);
    if let Some(existing) = index.iter_mut().find(|entry| entry.id == summary.id) {
        *existing = summary.clone();
    } else {
        index.push(summary.clone());
    }
    index.sort_by_key(|entry| std::cmp::Reverse(entry.updated_at));
    // Cap retained archives per project.
    const MAX_SESSIONS: usize = 50;
    if index.len() > MAX_SESSIONS {
        let overflow: Vec<_> = index.split_off(MAX_SESSIONS);
        for stale in overflow {
            let _ = fs::remove_file(archive_path(&dir, &stale.id));
        }
    }
    write_index(&dir, &index)?;
    Ok(summary)
}

#[tauri::command]
pub fn session_load(
    app: AppHandle,
    project_path: String,
    id: String,
) -> Result<SessionArchive, String> {
    let dir = project_dir(&app, &project_path)?;
    let path = archive_path(&dir, &id);
    if !path.exists() {
        return Err(format!("session `{id}` not found"));
    }
    read_jsonl(&path)
}

/// Retitle an archive in place: rewrites the meta line and the index entry, and
/// leaves the timeline and `updated_at` ordering untouched.
fn rename_in_dir(dir: &Path, id: &str, title: &str) -> Result<SessionSummary, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("session title is empty".into());
    }
    let path = archive_path(dir, id);
    if !path.exists() {
        return Err(format!("session `{id}` not found"));
    }

    let mut archive = read_jsonl(&path)?;
    archive.title = title.to_string();
    write_jsonl(&path, &archive)?;

    let mut index = read_index(dir);
    let summary = match index.iter_mut().find(|entry| entry.id == id) {
        Some(entry) => {
            entry.title = title.to_string();
            entry.clone()
        }
        None => {
            // Index lost or never written — rebuild this entry from the archive.
            let summary = SessionSummary {
                id: archive.id.clone(),
                title: archive.title.clone(),
                backend: archive.backend.clone(),
                created_at: archive.created_at,
                updated_at: archive.updated_at,
                item_count: archive.items.len() as u32,
                acp_session_id: archive.acp_session_id.clone(),
            };
            index.push(summary.clone());
            index.sort_by_key(|entry| std::cmp::Reverse(entry.updated_at));
            summary
        }
    };
    write_index(dir, &index)?;
    Ok(summary)
}

#[tauri::command]
pub fn session_rename(
    app: AppHandle,
    project_path: String,
    id: String,
    title: String,
) -> Result<SessionSummary, String> {
    let dir = project_dir(&app, &project_path)?;
    rename_in_dir(&dir, &id, &title)
}

#[tauri::command]
pub fn session_delete(app: AppHandle, project_path: String, id: String) -> Result<(), String> {
    let dir = project_dir(&app, &project_path)?;
    let path = archive_path(&dir, &id);
    if path.exists() {
        fs::remove_file(&path).map_err(|err| format!("failed to delete session: {err}"))?;
    }
    let mut index = read_index(&dir);
    index.retain(|entry| entry.id != id);
    write_index(&dir, &index)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("glyphra-session-test-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn jsonl_roundtrip() {
        let dir = tmp_dir();
        let path = archive_path(&dir, "sess-1");
        let archive = SessionArchive {
            id: "sess-1".into(),
            project_path: "/tmp/demo".into(),
            title: "Hello".into(),
            backend: "fixture".into(),
            created_at: 1,
            updated_at: 2,
            acp_session_id: Some("acp-1".into()),
            usage: Some(SessionUsage {
                total_tokens: 30,
                input_tokens: 20,
                output_tokens: 10,
                thought_tokens: None,
                cached_read_tokens: Some(4),
                cached_write_tokens: None,
            }),
            cost: Some(SessionCost {
                amount: 0.01,
                currency: "USD".into(),
            }),
            items: vec![
                serde_json::json!({"id":"u1","kind":"user","text":"hi","at":1}),
                serde_json::json!({"id":"a1","kind":"assistant","text":"yo","at":2}),
            ],
        };
        write_jsonl(&path, &archive).unwrap();
        let loaded = read_jsonl(&path).unwrap();
        assert_eq!(loaded.id, "sess-1");
        assert_eq!(loaded.items.len(), 2);
        assert_eq!(loaded.title, "Hello");
        assert_eq!(loaded.usage.unwrap().total_tokens, 30);
        let _ = fs::remove_dir_all(dir);
    }

    fn sample_archive(id: &str, title: &str) -> SessionArchive {
        SessionArchive {
            id: id.into(),
            project_path: "/tmp/demo".into(),
            title: title.into(),
            backend: "fixture".into(),
            created_at: 1,
            updated_at: 2,
            acp_session_id: None,
            usage: None,
            cost: None,
            items: vec![serde_json::json!({"id":"u1","kind":"user","text":"hi","at":1})],
        }
    }

    #[test]
    fn rename_updates_archive_and_index() {
        let dir = tmp_dir();
        let archive = sample_archive("sess-1", "hi");
        write_jsonl(&archive_path(&dir, "sess-1"), &archive).unwrap();
        write_index(
            &dir,
            &[SessionSummary {
                id: "sess-1".into(),
                title: "hi".into(),
                backend: "fixture".into(),
                created_at: 1,
                updated_at: 2,
                item_count: 1,
                acp_session_id: None,
            }],
        )
        .unwrap();

        let summary = rename_in_dir(&dir, "sess-1", "  Agent UI polish  ").unwrap();
        assert_eq!(summary.title, "Agent UI polish");
        // The timeline and ordering survive the retitle.
        let loaded = read_jsonl(&archive_path(&dir, "sess-1")).unwrap();
        assert_eq!(loaded.title, "Agent UI polish");
        assert_eq!(loaded.items.len(), 1);
        assert_eq!(loaded.updated_at, 2);
        assert_eq!(read_index(&dir)[0].title, "Agent UI polish");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rename_rebuilds_a_missing_index_entry() {
        let dir = tmp_dir();
        write_jsonl(
            &archive_path(&dir, "sess-2"),
            &sample_archive("sess-2", "hi"),
        )
        .unwrap();

        rename_in_dir(&dir, "sess-2", "Recovered").unwrap();
        let index = read_index(&dir);
        assert_eq!(index.len(), 1);
        assert_eq!(index[0].id, "sess-2");
        assert_eq!(index[0].title, "Recovered");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rename_rejects_blank_titles_and_unknown_sessions() {
        let dir = tmp_dir();
        write_jsonl(
            &archive_path(&dir, "sess-3"),
            &sample_archive("sess-3", "hi"),
        )
        .unwrap();

        assert!(rename_in_dir(&dir, "sess-3", "   ").is_err());
        assert!(rename_in_dir(&dir, "nope", "Title").is_err());
        assert_eq!(
            read_jsonl(&archive_path(&dir, "sess-3")).unwrap().title,
            "hi"
        );
        let _ = fs::remove_dir_all(dir);
    }
}
