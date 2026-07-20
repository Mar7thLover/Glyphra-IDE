//! Thin shell-out helpers for git (status / show / readonly exec).

use std::{
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/GitFileStatus.ts")]
pub struct GitFileStatus {
    pub path: String,
    /// Two-letter porcelain XY status (e.g. `M `, `??`, `A `).
    pub status: String,
}

pub fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|err| format!("failed to run git: {err}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git {} failed: {stderr}", args.join(" ")));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn status_porcelain(cwd: &Path) -> Result<Vec<GitFileStatus>, String> {
    let stdout = match run_git(cwd, &["status", "--porcelain"]) {
        Ok(text) => text,
        Err(_) => return Ok(Vec::new()),
    };
    let mut entries = Vec::new();
    for line in stdout.lines() {
        if line.len() < 4 {
            continue;
        }
        let status = line[..2].to_string();
        let path = line[3..].trim().to_string();
        if path.is_empty() {
            continue;
        }
        // `R  old -> new` — keep the new path.
        let path = path
            .rsplit_once(" -> ")
            .map(|(_, newer)| newer.to_string())
            .unwrap_or(path);
        entries.push(GitFileStatus { path, status });
    }
    Ok(entries)
}

pub fn show_head_file(cwd: &Path, rel_path: &str) -> Result<Option<String>, String> {
    let output = Command::new("git")
        .args(["show", &format!("HEAD:{rel_path}")])
        .current_dir(cwd)
        .output()
        .map_err(|err| format!("failed to run git show: {err}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    String::from_utf8(output.stdout)
        .map(Some)
        .map_err(|_| "git show returned non-UTF-8".to_string())
}

const READONLY_ALLOWLIST: &[&str] = &[
    "status",
    "diff",
    "log",
    "show",
    "rev-parse",
    "ls-files",
    "branch",
];

pub fn exec_readonly(cwd: &Path, args: &[String]) -> Result<String, String> {
    let Some(head) = args.first() else {
        return Err("empty git args".into());
    };
    if !READONLY_ALLOWLIST.iter().any(|allowed| allowed == head) {
        return Err(format!("git `{head}` is not on the readonly allowlist"));
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    run_git(cwd, &refs)
}

fn canonicalize_allow_missing(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }

    let mut cursor = path;
    let mut missing = Vec::new();
    while let Some(parent) = cursor.parent() {
        if let Some(name) = cursor.file_name() {
            missing.push(name.to_os_string());
        }
        if let Ok(mut canonical) = parent.canonicalize() {
            for part in missing.iter().rev() {
                canonical.push(part);
            }
            return canonical;
        }
        cursor = parent;
    }

    path.to_path_buf()
}

pub fn rel_path(project: &Path, absolute: &Path) -> Result<String, String> {
    let abs = canonicalize_allow_missing(absolute);
    let root = project
        .canonicalize()
        .unwrap_or_else(|_| project.to_path_buf());
    let rel = abs
        .strip_prefix(&root)
        .map_err(|_| format!("{} is outside project {}", abs.display(), root.display()))?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

pub fn project_root(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_dir() {
        return Err(format!("not a directory: {}", path.display()));
    }
    Ok(path.canonicalize().unwrap_or(path))
}
