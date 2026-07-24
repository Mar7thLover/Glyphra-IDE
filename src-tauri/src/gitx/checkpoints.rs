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
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use ts_rs::TS;
use uuid::Uuid;

use crate::process_ext::std_command;

use super::cli::{self, project_root, rel_path, DiffSummary};

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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/CkptHunkSummary.ts")]
pub struct CkptHunkSummary {
    pub path: String,
    pub summary: DiffSummary,
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

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|err| format!("app data dir: {err}"))
}

fn checkpoint_root_at(data_dir: &Path, project: &Path) -> Result<PathBuf, String> {
    let dir = data_dir.join("checkpoints").join(project_key(project));
    fs::create_dir_all(&dir).map_err(|err| format!("create checkpoint dir: {err}"))?;
    Ok(dir)
}

fn checkpoint_root(app: &AppHandle, project: &Path) -> Result<PathBuf, String> {
    checkpoint_root_at(&app_data_dir(app)?, project)
}

/// Skip huge binaries — restore is unavailable (no baseline stored).
const MAX_PREIMAGE_BYTES: u64 = 5 * 1024 * 1024;

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
    let status = std_command("git")
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
            let _ = std_command("git")
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
        self.begin_turn_at(&app_data_dir(app)?, project_path, label)
    }

    /// Begin a turn under an explicit data directory (tests + AppHandle path).
    pub fn begin_turn_at(
        &self,
        data_dir: &Path,
        project_path: &str,
        label: Option<String>,
    ) -> Result<CkptTurnMeta, String> {
        let project = project_root(project_path)?;
        let root = checkpoint_root_at(data_dir, &project)?;
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
        let mut preimaged = HashSet::new();

        // L3: snapshot currently dirty tracked/untracked files so restore works
        // even when the agent mutates via shell instead of ACP fs.write.
        if let Ok(dirty) = cli::status_porcelain(&project) {
            for entry in dirty {
                if entry.path.contains('\0') || entry.path.ends_with('/') {
                    continue;
                }
                let abs = project.join(&entry.path);
                if let Ok(()) = capture_preimage(data_dir, &project, &id, &abs, &entry.path) {
                    preimaged.insert(entry.path);
                }
            }
        }

        self.active
            .lock()
            .map_err(|_| "ckpt lock poisoned")?
            .insert(
                key,
                ActiveTurn {
                    id,
                    project,
                    preimaged,
                },
            );
        Ok(meta)
    }

    /// L1: capture current disk bytes (or empty) before first mutation in the turn.
    pub fn preimage(&self, app: &AppHandle, project_path: &str, path: &str) -> Result<(), String> {
        self.preimage_at(&app_data_dir(app)?, project_path, path)
    }

    pub fn preimage_at(
        &self,
        data_dir: &Path,
        project_path: &str,
        path: &str,
    ) -> Result<(), String> {
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
        capture_preimage(data_dir, &project, &turn.id, &abs, &rel)?;
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
        self.commit_turn_at(&app_data_dir(app)?, project_path, turn_id)
    }

    pub fn commit_turn_at(
        &self,
        data_dir: &Path,
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

        let root = checkpoint_root_at(data_dir, &project)?;
        let dir = turn_dir(&root, &turn.id);
        let mut files = Vec::new();

        for rel in &turn.preimaged {
            let abs = project.join(rel);
            let pre = pre_path(&dir, rel);
            let preimage_available = pre.exists();
            let before = fs::read(&pre).unwrap_or_default();
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
                preimage_available,
            });
        }

        // Best-effort shadow git commit of touched files.
        let git_dir = root.join("git");
        if git_dir.join("HEAD").exists() {
            for file in &files {
                let _ = std_command("git")
                    .args(["add", "--", &file.path])
                    .env("GIT_DIR", &git_dir)
                    .env("GIT_WORK_TREE", &project)
                    .status();
            }
            let _ = std_command("git")
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

    pub fn hunks(
        &self,
        app: &AppHandle,
        project_path: &str,
        turn_id: &str,
        rel_path: &str,
    ) -> Result<CkptHunkSummary, String> {
        let project = project_root(project_path)?;
        let root = checkpoint_root(app, &project)?;
        let dir = turn_dir(&root, turn_id);
        let meta = read_meta(&dir)?;
        let file = meta
            .files
            .iter()
            .find(|file| file.path == rel_path)
            .ok_or_else(|| format!("file `{rel_path}` not in turn"))?;
        if !file.preimage_available {
            return Ok(CkptHunkSummary {
                path: rel_path.to_string(),
                summary: DiffSummary {
                    available: false,
                    ..DiffSummary::default()
                },
            });
        }

        let pre = pre_path(&dir, rel_path);
        let after = project.join(rel_path);
        let before_bytes = fs::read(&pre).unwrap_or_default();
        let after_bytes = fs::read(&after).unwrap_or_default();
        let binary = before_bytes.contains(&0)
            || after_bytes.contains(&0)
            || std::str::from_utf8(&before_bytes).is_err()
            || std::str::from_utf8(&after_bytes).is_err();
        let mut summary = if binary {
            DiffSummary {
                binary: true,
                available: true,
                ..DiffSummary::default()
            }
        } else if before_bytes == after_bytes {
            DiffSummary {
                available: true,
                ..DiffSummary::default()
            }
        } else if !after.exists() || before_bytes.is_empty() || after_bytes.is_empty() {
            let count = |bytes: &[u8]| {
                if bytes.is_empty() {
                    0
                } else {
                    bytes.split(|byte| *byte == b'\n').count() as u32
                        - u32::from(bytes.last() == Some(&b'\n'))
                }
            };
            DiffSummary {
                additions: count(&after_bytes),
                deletions: count(&before_bytes),
                hunks: 1,
                binary: false,
                available: true,
            }
        } else {
            let output = std_command("git")
                .args(["diff", "--no-index", "--no-color", "--unified=0", "--"])
                .arg(&pre)
                .arg(&after)
                .output()
                .map_err(|err| format!("failed to summarize checkpoint diff: {err}"))?;
            if output.status.code() == Some(0) || output.status.code() == Some(1) {
                cli::parse_unified_diff(&String::from_utf8_lossy(&output.stdout))
            } else {
                return Err(String::from_utf8_lossy(&output.stderr).into_owned());
            }
        };
        summary.available = true;
        Ok(CkptHunkSummary {
            path: rel_path.to_string(),
            summary,
        })
    }

    pub fn restore_turn(
        &self,
        app: &AppHandle,
        project_path: &str,
        turn_id: &str,
    ) -> Result<CkptTurnMeta, String> {
        self.restore_turn_at(&app_data_dir(app)?, project_path, turn_id)
    }

    pub fn restore_turn_at(
        &self,
        data_dir: &Path,
        project_path: &str,
        turn_id: &str,
    ) -> Result<CkptTurnMeta, String> {
        let project = project_root(project_path)?;
        let root = checkpoint_root_at(data_dir, &project)?;
        let dir = turn_dir(&root, turn_id);
        let meta = read_meta(&dir)?;
        apply_restore(&project, &dir, &meta.files)?;
        Ok(meta)
    }

    pub fn restore_file(
        &self,
        app: &AppHandle,
        project_path: &str,
        turn_id: &str,
        rel_path: &str,
    ) -> Result<(), String> {
        self.restore_file_at(&app_data_dir(app)?, project_path, turn_id, rel_path)
    }

    pub fn restore_file_at(
        &self,
        data_dir: &Path,
        project_path: &str,
        turn_id: &str,
        rel_path: &str,
    ) -> Result<(), String> {
        let project = project_root(project_path)?;
        let root = checkpoint_root_at(data_dir, &project)?;
        let dir = turn_dir(&root, turn_id);
        let meta = read_meta(&dir)?;
        let file = meta
            .files
            .iter()
            .find(|f| f.path == rel_path)
            .ok_or_else(|| format!("file `{rel_path}` not in turn"))?
            .clone();
        apply_restore(&project, &dir, &[file])
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

fn capture_preimage(
    data_dir: &Path,
    project: &Path,
    turn_id: &str,
    abs: &Path,
    rel: &str,
) -> Result<(), String> {
    let root = checkpoint_root_at(data_dir, project)?;
    let dir = turn_dir(&root, turn_id);
    let dest = pre_path(&dir, rel);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|err| format!("preimage mkdir: {err}"))?;
    }

    if abs.exists() {
        let meta = fs::metadata(abs).map_err(|err| format!("preimage stat: {err}"))?;
        if meta.len() > MAX_PREIMAGE_BYTES {
            // No baseline — leave pre missing so restore skips / marks unavailable.
            return Err(format!(
                "skip preimage >{}MB: {rel}",
                MAX_PREIMAGE_BYTES / (1024 * 1024)
            ));
        }
    }

    // Prefer L1 disk bytes; fall back to L2 git HEAD for clean tracked files.
    let content = if abs.exists() {
        fs::read(abs).map_err(|err| format!("preimage read: {err}"))?
    } else if let Ok(Some(text)) = cli::show_head_file(project, rel) {
        text.into_bytes()
    } else {
        Vec::new()
    };
    fs::write(&dest, content).map_err(|err| format!("preimage write: {err}"))?;
    Ok(())
}

fn apply_restore(project: &Path, dir: &Path, files: &[CkptFileDiff]) -> Result<(), String> {
    for file in files {
        if !file.preimage_available {
            continue;
        }
        let dest = project.join(&file.path);
        let pre = pre_path(dir, &file.path);
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
    Ok(())
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

    fn temp_pair() -> (PathBuf, PathBuf) {
        let base = std::env::temp_dir().join(format!("glyphra-ckpt-{}", Uuid::new_v4()));
        let project = base.join("project");
        let data = base.join("data");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&data).unwrap();
        (project, data)
    }

    #[test]
    fn pre_path_sanitizes() {
        let dir = PathBuf::from("/tmp/turn");
        let path = pre_path(&dir, "src/../src/a.ts");
        assert!(path.ends_with("src/a.ts") || path.ends_with("a.ts"));
    }

    #[test]
    fn restore_turn_is_byte_accurate_for_modify_add_delete() {
        let (project, data) = temp_pair();
        let engine = CheckpointEngine::default();

        let keep = project.join("keep.bin");
        let modify = project.join("src/modify.bin");
        let delete = project.join("gone.bin");
        fs::create_dir_all(project.join("src")).unwrap();
        fs::write(&keep, b"untouched\x00\xff").unwrap();
        fs::write(&modify, b"before\x00data").unwrap();
        fs::write(&delete, b"will-delete").unwrap();

        let meta = engine
            .begin_turn_at(&data, &project.to_string_lossy(), Some("byte test".into()))
            .expect("begin");

        engine
            .preimage_at(&data, &project.to_string_lossy(), &modify.to_string_lossy())
            .unwrap();
        engine
            .preimage_at(&data, &project.to_string_lossy(), &delete.to_string_lossy())
            .unwrap();
        let added = project.join("new.bin");
        engine
            .preimage_at(&data, &project.to_string_lossy(), &added.to_string_lossy())
            .unwrap();

        fs::write(&modify, b"after\x01MUTATED").unwrap();
        fs::remove_file(&delete).unwrap();
        fs::write(&added, b"brand-new\xfe").unwrap();

        let committed = engine
            .commit_turn_at(&data, &project.to_string_lossy(), Some(meta.id.clone()))
            .expect("commit");
        assert!(committed.files.iter().any(|f| f.path == "src/modify.bin"));
        assert!(committed.files.iter().any(|f| f.path == "gone.bin"));
        assert!(committed.files.iter().any(|f| f.path == "new.bin"));

        engine
            .restore_turn_at(&data, &project.to_string_lossy(), &meta.id)
            .expect("restore");

        assert_eq!(fs::read(&modify).unwrap(), b"before\x00data");
        assert_eq!(fs::read(&delete).unwrap(), b"will-delete");
        assert!(!added.exists(), "added file should be removed on restore");
        assert_eq!(fs::read(&keep).unwrap(), b"untouched\x00\xff");

        let _ = fs::remove_dir_all(project.parent().unwrap());
    }

    #[test]
    fn restore_file_is_byte_accurate() {
        let (project, data) = temp_pair();
        let engine = CheckpointEngine::default();
        let target = project.join("only.bin");
        fs::write(&target, [0u8, 1, 2, 3, 255]).unwrap();

        let meta = engine
            .begin_turn_at(&data, &project.to_string_lossy(), None)
            .unwrap();
        engine
            .preimage_at(&data, &project.to_string_lossy(), &target.to_string_lossy())
            .unwrap();
        fs::write(&target, [9u8, 8, 7]).unwrap();
        engine
            .commit_turn_at(&data, &project.to_string_lossy(), Some(meta.id.clone()))
            .unwrap();

        engine
            .restore_file_at(&data, &project.to_string_lossy(), &meta.id, "only.bin")
            .unwrap();
        assert_eq!(fs::read(&target).unwrap(), vec![0u8, 1, 2, 3, 255]);

        let _ = fs::remove_dir_all(project.parent().unwrap());
    }

    #[test]
    fn skips_oversized_binary_preimage() {
        let (project, data) = temp_pair();
        let engine = CheckpointEngine::default();
        let big = project.join("huge.bin");
        // Allocate just over the limit without writing 5MB+ of real I/O if possible —
        // write a sparse-ish file via set_len when available; fall back to chunk write.
        {
            let file = fs::File::create(&big).unwrap();
            file.set_len(MAX_PREIMAGE_BYTES + 1).unwrap();
        }

        let meta = engine
            .begin_turn_at(&data, &project.to_string_lossy(), None)
            .unwrap();
        let err = engine
            .preimage_at(&data, &project.to_string_lossy(), &big.to_string_lossy())
            .unwrap_err();
        assert!(err.contains("skip preimage"), "{err}");

        // Turn can still commit with no files if only oversized paths failed L1.
        let committed = engine
            .commit_turn_at(&data, &project.to_string_lossy(), Some(meta.id))
            .unwrap();
        assert!(committed.files.is_empty());

        let _ = fs::remove_dir_all(project.parent().unwrap());
    }
}
