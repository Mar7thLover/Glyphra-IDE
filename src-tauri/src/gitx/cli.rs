//! Thin shell-out helpers for git (status / show / readonly exec).

use std::{
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/DiffSummary.ts")]
pub struct DiffSummary {
    #[ts(type = "number")]
    pub additions: u32,
    #[ts(type = "number")]
    pub deletions: u32,
    #[ts(type = "number")]
    pub hunks: u32,
    pub binary: bool,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/GitFileDiff.ts")]
pub struct GitFileDiff {
    pub path: String,
    pub status: String,
    pub before: String,
    pub after: String,
    pub summary: DiffSummary,
}

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
    let stdout = match run_git(cwd, &["status", "--porcelain", "--untracked-files=all"]) {
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
    let Some(bytes) = show_head_bytes(cwd, rel_path)? else {
        return Ok(None);
    };
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| "git show returned non-UTF-8".to_string())
}

pub fn show_head_bytes(cwd: &Path, rel_path: &str) -> Result<Option<Vec<u8>>, String> {
    let output = Command::new("git")
        .args(["show", &format!("HEAD:{rel_path}")])
        .current_dir(cwd)
        .output()
        .map_err(|err| format!("failed to run git show: {err}"))?;
    if !output.status.success() {
        return Ok(None);
    }
    Ok(Some(output.stdout))
}

fn is_binary(bytes: &[u8]) -> bool {
    bytes.contains(&0) || std::str::from_utf8(bytes).is_err()
}

fn line_count(bytes: &[u8]) -> u32 {
    if bytes.is_empty() {
        0
    } else {
        bytes.split(|byte| *byte == b'\n').count() as u32 - u32::from(bytes.last() == Some(&b'\n'))
    }
}

pub fn parse_unified_diff(patch: &str) -> DiffSummary {
    let mut summary = DiffSummary {
        available: true,
        ..DiffSummary::default()
    };
    for line in patch.lines() {
        if line.starts_with("@@") {
            summary.hunks += 1;
        } else if line.starts_with('+') && !line.starts_with("+++") {
            summary.additions += 1;
        } else if line.starts_with('-') && !line.starts_with("---") {
            summary.deletions += 1;
        } else if line.starts_with("Binary files ") || line.starts_with("GIT binary patch") {
            summary.binary = true;
        }
    }
    summary
}

fn fallback_summary(before: &[u8], after: &[u8]) -> DiffSummary {
    let binary = is_binary(before) || is_binary(after);
    let changed = before != after;
    DiffSummary {
        additions: if binary || !changed {
            0
        } else {
            line_count(after)
        },
        deletions: if binary || !changed {
            0
        } else {
            line_count(before)
        },
        hunks: u32::from(changed && !binary),
        binary,
        available: true,
    }
}

pub fn diff_file(cwd: &Path, path: &str, base: &str) -> Result<GitFileDiff, String> {
    if base != "HEAD" {
        return Err(format!("unsupported diff base `{base}`"));
    }
    let joined = cwd.join(path);
    let normalized = rel_path(cwd, &joined)?;
    if normalized != path.replace('\\', "/") {
        return Err(format!("invalid project-relative path `{path}`"));
    }

    let before = show_head_bytes(cwd, &normalized)?;
    let tracked_at_head = before.is_some();
    let before_bytes = before.unwrap_or_default();
    let after_bytes = if joined.is_file() {
        std::fs::read(&joined).map_err(|err| format!("read {normalized}: {err}"))?
    } else {
        Vec::new()
    };
    let binary = is_binary(&before_bytes) || is_binary(&after_bytes);

    let output = Command::new("git")
        .args([
            "diff",
            "--no-ext-diff",
            "--no-color",
            "--unified=0",
            base,
            "--",
            &normalized,
        ])
        .current_dir(cwd)
        .output()
        .map_err(|err| format!("failed to run git diff: {err}"))?;
    let mut summary = if output.status.success() {
        parse_unified_diff(&String::from_utf8_lossy(&output.stdout))
    } else {
        fallback_summary(&before_bytes, &after_bytes)
    };
    if before_bytes != after_bytes && summary.hunks == 0 && !summary.binary && !binary {
        summary = fallback_summary(&before_bytes, &after_bytes);
    }
    summary.binary |= binary;

    let porcelain = status_porcelain(cwd)?;
    let xy = porcelain
        .iter()
        .find(|entry| entry.path.replace('\\', "/") == normalized)
        .map(|entry| entry.status.as_str())
        .unwrap_or("");
    let status = if xy.contains('D') || (!joined.exists() && !before_bytes.is_empty()) {
        "deleted"
    } else if xy.contains('A') || xy == "??" || !tracked_at_head {
        "added"
    } else {
        "modified"
    };

    Ok(GitFileDiff {
        path: normalized,
        status: status.into(),
        before: if binary {
            String::new()
        } else {
            String::from_utf8_lossy(&before_bytes).into_owned()
        },
        after: if binary {
            String::new()
        } else {
            String::from_utf8_lossy(&after_bytes).into_owned()
        },
        summary,
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hunks_and_line_totals() {
        let patch =
            "--- a/file\n+++ b/file\n@@ -1 +1,2 @@\n-old\n+new\n+more\n@@ -8 +9 @@\n-gone\n";
        assert_eq!(
            parse_unified_diff(patch),
            DiffSummary {
                additions: 2,
                deletions: 2,
                hunks: 2,
                binary: false,
                available: true,
            }
        );
    }

    #[test]
    fn fallback_counts_new_file_lines() {
        assert_eq!(
            fallback_summary(b"", b"one\ntwo\n"),
            DiffSummary {
                additions: 2,
                deletions: 0,
                hunks: 1,
                binary: false,
                available: true,
            }
        );
    }

    #[test]
    fn file_diff_uses_head_as_the_text_baseline() {
        let root = std::env::temp_dir().join(format!(
            "glyphra-diff-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        run_git(&root, &["init"]).unwrap();
        run_git(&root, &["config", "user.name", "Glyphra Test"]).unwrap();
        run_git(&root, &["config", "user.email", "test@glyphra.local"]).unwrap();
        std::fs::write(root.join("file.txt"), "before\n").unwrap();
        run_git(&root, &["add", "file.txt"]).unwrap();
        run_git(&root, &["commit", "-m", "baseline"]).unwrap();
        std::fs::write(root.join("file.txt"), "after\nmore\n").unwrap();

        let result = diff_file(&root, "file.txt", "HEAD").unwrap();
        assert_eq!(result.status, "modified");
        assert_eq!(result.before, "before\n");
        assert_eq!(result.after, "after\nmore\n");
        assert_eq!(result.summary.additions, 2);
        assert_eq!(result.summary.deletions, 1);
        assert_eq!(result.summary.hunks, 1);

        let _ = std::fs::remove_dir_all(root);
    }
}
