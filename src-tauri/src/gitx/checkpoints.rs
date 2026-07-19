//! Per-turn checkpoint engine (Cline-style shadow snapshots).
//!
//! Layout under app data:
//! ```text
//! checkpoints/<projectHash>/
//!   turns/<turnId>/
//!     meta.json
//!     pre/<relative/path>   # L1/L2 preimage bytes (empty file marker for new files)
//! ```
//!
//! A shadow git repo (`git/`) records turn commits when `git` is available so
//! `ckpt_restore` can also fall back to `git checkout`.

use std::{
    collections::{HashMap, HashSet},
    fs,
    hash::{Hash, Hasher},
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use ts_rs::TS;
use uuid::Uuid;

use super::cli::{self, project_root, rel_path};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/CkptTurnMeta.ts")]
pub struct CkptTurnMeta {
    pub id: String,
    pub project_path: String,
    #[ts(type = "number")]
    pub created_at: u64,
    #[ts(type = "number")]
    pub committed_at: Option<u64>,
    pub files: Vec<CkptFileDiff>,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/CkptFileDiff.ts")]
pub struct CkptFileDiff {
    pub path: String,
    pub status: String,
    pub preimage_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/CkptFileContents.ts")]
pub struct CkptFileContents {
    pub path: String,
    pub before: String,
    pub after: String,
}

#[derive(Default)]
struct ActiveTurn {
    id: String,
    project: PathBuf,
    preimaged: HashSet<String>,
}

#[derive(Default)]
pub struct CheckpointEngine {
    active: Mutex<HashMap<String, ActiveTurn>>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn project_key(project: &Path) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    project.to_string_lossy().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn checkpoint_root(app: &AppHandle, project: &Path) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("app data dir: {err}"))?
        .join("checkpoints")
        .join(project_key(project));
    fs::create_dir_all(&dir).map_err(|err| format!("create checkpoint dir: {err}"))?;
    Ok(dir)
}

fn turn_dir(root: &Path, turn_id: &str) -> PathBuf {
    root.join("turns").join(turn_id)
}

fn pre_path(turn_dir: &Path, rel: &str) -> PathBuf {
    let mut path = turn_dir.join("pre");
    for part in rel.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            continue;
        }
        path.push(part);
    }
    path
}

fn ensure_shadow_git(root: &Path, project: &Path) -> Result<(), String> {
    let git_dir = root.join("git");
    if git_dir.join("HEAD").exists() {
        return Ok(());
    }
    fs::create_dir_all(&git_dir).map_err(|err| format!("create shadow git: {err}"))?;
    let status = Command::new("git")
        .args(["init"])
        .env("GIT_DIR", &git_dir)
        .env("GIT_WORK_TREE", project)
        .status();
    match status {
        Ok(code) if code.success() => {
            let exclude = git_dir.join("info");
            let _ = fs::create_dir_all(&exclude);
            let exclude_file = exclude.join("exclude");
            let _ = fs::write(
                exclude_file,
                "node_modules/\n.target/\ndist/\n.git/\n*.png\n*.jpg\n*.lock\n",
            );
            // Initial empty commit so HEAD exists.
            let _ = Command::new("git")
                .args(["commit", "--allow-empty", "-m", "glyphra shadow baseline"])
                .env("GIT_DIR", &git_dir)
                .env("GIT_WORK_TREE", project)
                .env("GIT_AUTHOR_NAME", "Glyphra")
                .env("GIT_AUTHOR_EMAIL", "checkpoint@glyphra.local")
                .env("GIT_COMMITTER_NAME", "Glyphra")
                .env("GIT_COMMITTER_EMAIL", "checkpoint@glyphra.local")
                .status();
            Ok(())
        }
        Ok(_) | Err(_) => {
            // Git missing — file preimages still work.
            Ok(())
        }
    }
}

impl CheckpointEngine {
    pub fn begin_turn(
        &self,
        app: &AppHandle,
        project_path: &str,
        label: Option<String>,
    ) -> Result<CkptTurnMeta, String> {
        let project = project_root(project_path)?;
        let root = checkpoint_root(app, &project)?;
        ensure_shadow_git(&root, &project)?;

        let id = Uuid::new_v4().to_string();
        let created_at = now_ms();
        let dir = turn_dir(&root, &id);
        fs::create_dir_all(dir.join("pre")).map_err(|err| format!("create turn dir: {err}"))?;

        let meta = CkptTurnMeta {
            id: id.clone(),
            project_path: project.to_string_lossy().to_string(),
            created_at,
            committed_at: None,
            files: Vec::new(),
            label: label.unwrap_or_else(|| "Agent turn".into()),
        };
        write_meta(&dir, &meta)?;

        let key = project.to_string_lossy().to_string();
        self.active
            .lock()
            .map_err(|_| "ckpt lock poisoned")?
            .insert(
                key,
                ActiveTurn {
                    id,
                    project,
                    preimaged: HashSet::new(),
                },
            );
        Ok(meta)
    }

    /// L1: capture current disk bytes (or empty) before first mutation in the turn.
    pub fn preimage(&self, app: &AppHandle, project_path: &str, path: &str) -> Result<(), String> {
        let project = project_root(project_path)?;
        let key = project.to_string_lossy().to_string();
        let mut guard = self.active.lock().map_err(|_| "ckpt lock poisoned")?;
        let Some(turn) = guard.get_mut(&key) else {
            return Ok(());
        };
        let abs = PathBuf::from(path);
        let rel = rel_path(&project, &abs)?;
        if turn.preimaged.contains(&rel) {
            return Ok(());
        }

        let root = checkpoint_root(app, &project)?;
        let dir = turn_dir(&root, &turn.id);
        let dest = pre_path(&dir, &rel);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|err| format!("preimage mkdir: {err}"))?;
        }

        // Prefer L1 disk bytes; fall back to L2 git HEAD for clean tracked files.
        let content = if abs.exists() {
            fs::read(&abs).map_err(|err| format!("preimage read: {err}"))?
        } else if let Ok(Some(text)) = cli::show_head_file(&project, &rel) {
            text.into_bytes()
        } else {
            Vec::new()
        };
        fs::write(&dest, content).map_err(|err| format!("preimage write: {err}"))?;
        // Marker for "new file had no preimage"
        turn.preimaged.insert(rel);
        Ok(())
    }

    /// Capture preimage for any path under a project with an active turn (fs_write hook).
    pub fn preimage_for_path(&self, app: &AppHandle, absolute_path: &Path) -> Result<(), String> {
        let abs = absolute_path
            .canonicalize()
            .unwrap_or_else(|_| absolute_path.to_path_buf());
        let project_key = {
            let guard = self.active.lock().map_err(|_| "ckpt lock poisoned")?;
            guard.iter().find_map(|(key, turn)| {
                if abs.starts_with(&turn.project) {
                    Some(key.clone())
                } else {
                    None
                }
            })
        };
        if let Some(project_key) = project_key {
            return self.preimage(app, &project_key, &abs.to_string_lossy());
        }
        Ok(())
    }

    pub fn commit_turn(
        &self,
        app: &AppHandle,
        project_path: &str,
        turn_id: Option<String>,
    ) -> Result<CkptTurnMeta, String> {
        let project = project_root(project_path)?;
        let key = project.to_string_lossy().to_string();
        let mut guard = self.active.lock().map_err(|_| "ckpt lock poisoned")?;
        let turn = match turn_id {
            Some(id) => guard
                .remove(&key)
                .filter(|t| t.id == id)
                .ok_or_else(|| format!("turn `{id}` is not active"))?,
            None => guard
                .remove(&key)
                .ok_or_else(|| "no active checkpoint turn".to_string())?,
        };
        drop(guard);

        let root = checkpoint_root(app, &project)?;
        let dir = turn_dir(&root, &turn.id);
        let mut files = Vec::new();

        for rel in &turn.preimaged {
            let abs = project.join(rel);
            let before = fs::read(pre_path(&dir, rel)).unwrap_or_default();
            let after = if abs.exists() {
                fs::read(&abs).unwrap_or_default()
            } else {
                Vec::new()
            };
            let status = if before.is_empty() && !after.is_empty() {
                "added"
            } else if !before.is_empty() && after.is_empty() {
                "deleted"
            } else if before != after {
                "modified"
            } else {
                "unchanged"
            };
            if status == "unchanged" {
                continue;
            }
            files.push(CkptFileDiff {
                path: rel.clone(),
                status: status.into(),
                preimage_available: true,
            });
        }

        // Best-effort shadow git commit of touched files.
        let git_dir = root.join("git");
        if git_dir.join("HEAD").exists() {
            for file in &files {
                let _ = Command::new("git")
                    .args(["add", "--", &file.path])
                    .env("GIT_DIR", &git_dir)
                    .env("GIT_WORK_TREE", &project)
                    .status();
            }
            let _ = Command::new("git")
                .args(["commit", "-m", &format!("turn {}", turn.id)])
                .env("GIT_DIR", &git_dir)
                .env("GIT_WORK_TREE", &project)
                .env("GIT_AUTHOR_NAME", "Glyphra")
                .env("GIT_AUTHOR_EMAIL", "checkpoint@glyphra.local")
                .env("GIT_COMMITTER_NAME", "Glyphra")
                .env("GIT_COMMITTER_EMAIL", "checkpoint@glyphra.local")
                .status();
        }

        let mut meta = read_meta(&dir)?;
        meta.committed_at = Some(now_ms());
        meta.files = files;
        write_meta(&dir, &meta)?;
        Ok(meta)
    }

    pub fn list_turns(
        &self,
        app: &AppHandle,
        project_path: &str,
    ) -> Result<Vec<CkptTurnMeta>, String> {
        let project = project_root(project_path)?;
        let root = checkpoint_root(app, &project)?;
        let turns_dir = root.join("turns");
        if !turns_dir.exists() {
            return Ok(Vec::new());
        }
        let mut turns = Vec::new();
        for entry in fs::read_dir(&turns_dir).map_err(|err| err.to_string())? {
            let entry = entry.map_err(|err| err.to_string())?;
            if !entry.path().is_dir() {
                continue;
            }
            if let Ok(meta) = read_meta(&entry.path()) {
                if meta.committed_at.is_some() {
                    turns.push(meta);
                }
            }
        }
        turns.sort_by_key(|t| std::cmp::Reverse(t.created_at));
        Ok(turns)
    }

    pub fn file_contents(
        &self,
        app: &AppHandle,
        project_path: &str,
        turn_id: &str,
        rel_path: &str,
    ) -> Result<CkptFileContents, String> {
        let project = project_root(project_path)?;
        let root = checkpoint_root(app, &project)?;
        let dir = turn_dir(&root, turn_id);
        let before = fs::read_to_string(pre_path(&dir, rel_path)).unwrap_or_default();
        let after_path = project.join(rel_path);
        let after = fs::read_to_string(&after_path).unwrap_or_default();
        Ok(CkptFileContents {
            path: rel_path.to_string(),
            before,
            after,
        })
    }

    pub fn restore_turn(
        &self,
        app: &AppHandle,
        project_path: &str,
        turn_id: &str,
    ) -> Result<CkptTurnMeta, String> {
        let project = project_root(project_path)?;
        let root = checkpoint_root(app, &project)?;
        let dir = turn_dir(&root, turn_id);
        let meta = read_meta(&dir)?;
        for file in &meta.files {
            let dest = project.join(&file.path);
            let pre = pre_path(&dir, &file.path);
            if file.status == "added" {
                let _ = fs::remove_file(&dest);
                continue;
            }
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            let bytes = fs::read(&pre).unwrap_or_default();
            fs::write(&dest, bytes).map_err(|err| format!("restore {}: {err}", file.path))?;
        }
        Ok(meta)
    }

    pub fn restore_file(
        &self,
        app: &AppHandle,
        project_path: &str,
        turn_id: &str,
        rel_path: &str,
    ) -> Result<(), String> {
        let project = project_root(project_path)?;
        let root = checkpoint_root(app, &project)?;
        let dir = turn_dir(&root, turn_id);
        let meta = read_meta(&dir)?;
        let file = meta
            .files
            .iter()
            .find(|f| f.path == rel_path)
            .ok_or_else(|| format!("file `{rel_path}` not in turn"))?;
        let dest = project.join(rel_path);
        if file.status == "added" {
            let _ = fs::remove_file(&dest);
            return Ok(());
        }
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let bytes = fs::read(pre_path(&dir, rel_path)).unwrap_or_default();
        fs::write(dest, bytes).map_err(|err| err.to_string())?;
        Ok(())
    }

    pub fn write_file_content(
        project_path: &str,
        rel_path: &str,
        content: &str,
    ) -> Result<(), String> {
        let project = project_root(project_path)?;
        let dest = project.join(rel_path);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let mut file = fs::File::create(&dest).map_err(|err| err.to_string())?;
        file.write_all(content.as_bytes())
            .map_err(|err| err.to_string())?;
        Ok(())
    }
}

fn write_meta(dir: &Path, meta: &CkptTurnMeta) -> Result<(), String> {
    let data = serde_json::to_string_pretty(meta).map_err(|err| err.to_string())?;
    fs::write(dir.join("meta.json"), data).map_err(|err| err.to_string())
}

fn read_meta(dir: &Path) -> Result<CkptTurnMeta, String> {
    let data = fs::read_to_string(dir.join("meta.json")).map_err(|err| err.to_string())?;
    serde_json::from_str(&data).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pre_path_sanitizes() {
        let dir = PathBuf::from("/tmp/turn");
        let path = pre_path(&dir, "src/../src/a.ts");
        assert!(path.ends_with("src/a.ts") || path.ends_with("a.ts"));
    }
}
