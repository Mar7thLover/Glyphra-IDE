//! Thin shell-out helpers for git (status / show / readonly exec).

use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Stdio,
};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::process_ext::std_command;

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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/GitCommitResult.ts")]
pub struct GitCommitResult {
    pub hash: String,
    pub summary: String,
}

/// Ceiling on bytes read from one git subprocess. `status --porcelain -uall`
/// and `ls-files -co` are proportional to the size of the tree, and a workspace
/// root can be an entire drive: unbounded, the whole listing is materialized in
/// Rust, serialized over IPC and parsed again in the webview.
const MAX_GIT_STDOUT_BYTES: u64 = 8 * 1024 * 1024;
const MAX_GIT_STDERR_BYTES: u64 = 64 * 1024;
/// Working-tree entries returned to the frontend. Past this a status listing is
/// not a review queue, it is a memory bill.
const MAX_STATUS_ENTRIES: usize = 5_000;
/// Per-side ceiling on inlined diff text. Above it the diff is reported without
/// contents instead of shipping the file three times over IPC.
const MAX_DIFF_TEXT_BYTES: usize = 4 * 1024 * 1024;

pub fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let output = std_command("git")
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

/// Run git, reading at most `limit` bytes of stdout and killing the child once
/// the cap is reached. Returns `(stdout, truncated)`; truncation lands on a line
/// boundary so callers can keep parsing line by line.
///
/// stderr is drained on its own thread: with both pipes attached, blocking on
/// stdout while git blocks writing a full stderr pipe deadlocks both processes.
pub fn run_git_bounded(cwd: &Path, args: &[&str], limit: u64) -> Result<(String, bool), String> {
    let mut child = std_command("git")
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to run git: {err}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to open git stdout".to_string())?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to open git stderr".to_string())?;

    let drain = std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stderr
            .by_ref()
            .take(MAX_GIT_STDERR_BYTES)
            .read_to_end(&mut buffer);
        let _ = std::io::copy(&mut stderr, &mut std::io::sink());
        buffer
    });

    let mut bytes = Vec::new();
    let read = stdout
        .by_ref()
        .take(limit.saturating_add(1))
        .read_to_end(&mut bytes);
    let truncated = read.is_ok() && bytes.len() as u64 > limit;
    if truncated {
        let cut = bytes[..limit as usize]
            .iter()
            .rposition(|byte| *byte == b'\n')
            .map(|index| index + 1)
            .unwrap_or(0);
        bytes.truncate(cut);
    }
    if truncated || read.is_err() {
        // Stop git producing the rest, then let the pipe reach EOF so nothing
        // below blocks on a writer still trying to flush.
        let _ = child.kill();
        let _ = std::io::copy(&mut stdout, &mut std::io::sink());
    }
    // Reap the child before joining: the drain thread only returns once git
    // closes stderr, which a git blocked on a full stdout pipe never would.
    let status = child
        .wait()
        .map_err(|err| format!("failed to wait for git: {err}"))?;
    let errors = drain.join().unwrap_or_default();
    read.map_err(|err| format!("failed to read git output: {err}"))?;

    if !truncated && !status.success() {
        return Err(format!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&errors)
        ));
    }
    Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
}

/// Parse `git status --porcelain` output into at most `MAX_STATUS_ENTRIES`.
/// Porcelain paths are always repository-root relative; `prefix` rebases them
/// onto the directory that was actually opened (empty at the repository root).
fn parse_status_porcelain(stdout: &str, prefix: &str) -> Vec<GitFileStatus> {
    let mut entries = Vec::new();
    for line in stdout.lines() {
        if entries.len() >= MAX_STATUS_ENTRIES {
            break;
        }
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
        let path = if prefix.is_empty() {
            path
        } else {
            match path.strip_prefix(prefix) {
                Some(relative) if !relative.is_empty() => relative.to_string(),
                // Outside the opened subtree — the pathspec should have
                // excluded it, and it cannot be resolved against this root.
                _ => continue,
            }
        };
        entries.push(GitFileStatus { path, status });
    }
    entries
}

pub fn status_porcelain(cwd: &Path) -> Result<Vec<GitFileStatus>, String> {
    // A workspace root is frequently a subdirectory of a repository (a package
    // in a monorepo, an asset folder). Plain `git status` there walks the whole
    // repository and reports it, so opening one folder used to cost a scan of
    // everything above it. `-- .` limits the scan to the opened subtree, and
    // `--show-prefix` lets the results be rebased onto it.
    let prefix = run_git(cwd, &["rev-parse", "--show-prefix"])
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    let stdout = match run_git_bounded(
        cwd,
        &["status", "--porcelain", "--untracked-files=all", "--", "."],
        MAX_GIT_STDOUT_BYTES,
    ) {
        Ok((text, _)) => text,
        Err(_) => return Ok(Vec::new()),
    };
    Ok(parse_status_porcelain(&stdout, &prefix))
}

/// Porcelain XY for a single path. `diff_file` used to scan the whole
/// repository for this, which made a per-file diff cost O(tree) — and the
/// review queue calls it once per changed file.
fn status_xy_for_path(cwd: &Path, rel_path: &str) -> String {
    // `:(literal)` keeps a filename containing glob characters from being
    // interpreted as a pathspec pattern.
    let pathspec = format!(":(literal){rel_path}");
    let Ok((stdout, _)) = run_git_bounded(
        cwd,
        &[
            "status",
            "--porcelain",
            "--untracked-files=all",
            "--",
            &pathspec,
        ],
        64 * 1024,
    ) else {
        return String::new();
    };
    // Only the XY is read, so the reported path's base does not matter here.
    parse_status_porcelain(&stdout, "")
        .first()
        .map(|entry| entry.status.clone())
        .unwrap_or_default()
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
    // `HEAD:path` resolves against the repository root, `HEAD:./path` against
    // the current directory. Callers pass paths relative to the project root,
    // which is often a subdirectory of the repository — without `./` every
    // lookup there silently misses and the file reads as untracked.
    let output = std_command("git")
        .args(["show", &format!("HEAD:./{rel_path}")])
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

    let output = std_command("git")
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

    let xy = status_xy_for_path(cwd, &normalized);
    let status = if xy.contains('D') || (!joined.exists() && !before_bytes.is_empty()) {
        "deleted"
    } else if xy.contains('A') || xy == "??" || !tracked_at_head {
        "added"
    } else {
        "modified"
    };

    // Both revisions cross IPC as strings and are held by the review store, so
    // an oversized file is reported without its contents rather than copied
    // three times into the webview.
    let oversized =
        before_bytes.len() > MAX_DIFF_TEXT_BYTES || after_bytes.len() > MAX_DIFF_TEXT_BYTES;
    let inline_text = !binary && !oversized;

    Ok(GitFileDiff {
        path: normalized,
        status: status.into(),
        before: if inline_text {
            String::from_utf8_lossy(&before_bytes).into_owned()
        } else {
            String::new()
        },
        after: if inline_text {
            String::from_utf8_lossy(&after_bytes).into_owned()
        } else {
            String::new()
        },
        summary: DiffSummary {
            available: summary.available && !oversized,
            ..summary
        },
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

/// Readonly passthrough for the frontend. `ls-files -co` over an unignored tree
/// is unbounded, so every call is capped — callers see a line-aligned prefix
/// rather than the app dying while marshalling a whole drive listing.
pub fn exec_readonly(cwd: &Path, args: &[String]) -> Result<String, String> {
    let Some(head) = args.first() else {
        return Err("empty git args".into());
    };
    if !READONLY_ALLOWLIST.iter().any(|allowed| allowed == head) {
        return Err(format!("git `{head}` is not on the readonly allowlist"));
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let (stdout, truncated) = run_git_bounded(cwd, &refs, MAX_GIT_STDOUT_BYTES)?;
    if truncated {
        tracing::warn!(
            target: "git",
            command = %args.join(" "),
            limit = MAX_GIT_STDOUT_BYTES,
            "git output truncated at the readonly cap"
        );
    }
    Ok(stdout)
}

pub fn commit_all(cwd: &Path, message: &str) -> Result<GitCommitResult, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("commit message is empty".into());
    }
    if message.len() > 4096 || message.contains('\0') {
        return Err("commit message is invalid or exceeds 4096 bytes".into());
    }
    let top_level = run_git(cwd, &["rev-parse", "--show-toplevel"])?;
    let top_level = PathBuf::from(top_level.trim())
        .canonicalize()
        .map_err(|err| format!("failed to resolve repository root: {err}"))?;
    let project = cwd
        .canonicalize()
        .map_err(|err| format!("failed to resolve project root: {err}"))?;
    if top_level != project {
        return Err(format!(
            "project root {} is not the Git repository root {}",
            project.display(),
            top_level.display()
        ));
    }
    if status_porcelain(cwd)?.is_empty() {
        return Err("working tree has no changes to commit".into());
    }

    run_git(cwd, &["add", "--all"])?;
    let mut child = std_command("git")
        .args(["commit", "--file", "-"])
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to run git commit: {err}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "failed to open git commit stdin".to_string())?
        .write_all(message.as_bytes())
        .map_err(|err| format!("failed to write commit message: {err}"))?;
    let output = child
        .wait_with_output()
        .map_err(|err| format!("failed to wait for git commit: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "git commit failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let hash = run_git(cwd, &["rev-parse", "HEAD"])?.trim().to_string();
    Ok(GitCommitResult {
        hash,
        summary: String::from_utf8_lossy(&output.stdout).trim().to_string(),
    })
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

    fn scratch_repo(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "glyphra-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        run_git(&root, &["init"]).unwrap();
        run_git(&root, &["config", "user.name", "Glyphra Test"]).unwrap();
        run_git(&root, &["config", "user.email", "test@glyphra.local"]).unwrap();
        root
    }

    #[test]
    fn bounded_git_truncates_on_a_line_boundary_without_reporting_failure() {
        let root = scratch_repo("bounded");
        for index in 0..40 {
            std::fs::write(root.join(format!("untracked-file-{index:03}.txt")), "x").unwrap();
        }

        let (full, truncated) = run_git_bounded(
            &root,
            &["status", "--porcelain", "--untracked-files=all"],
            MAX_GIT_STDOUT_BYTES,
        )
        .expect("full status");
        assert!(!truncated);
        assert_eq!(full.lines().count(), 40);

        // A cap far below the real output must yield whole lines, no error, and
        // no partial trailing entry.
        let (capped, truncated) = run_git_bounded(
            &root,
            &["status", "--porcelain", "--untracked-files=all"],
            100,
        )
        .expect("capped status");
        assert!(truncated);
        assert!(capped.len() <= 100, "{} bytes", capped.len());
        assert!(capped.ends_with('\n'));
        for line in capped.lines() {
            assert!(
                line.starts_with("?? untracked-file-"),
                "partial line: {line}"
            );
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn status_parsing_caps_entries_and_keeps_rename_targets() {
        let lines = (0..MAX_STATUS_ENTRIES + 25)
            .map(|index| format!("?? file-{index}.txt"))
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(parse_status_porcelain(&lines, "").len(), MAX_STATUS_ENTRIES);

        let renamed = parse_status_porcelain("R  old/name.txt -> new/name.txt\n", "");
        assert_eq!(renamed[0].path, "new/name.txt");
        assert_eq!(renamed[0].status, "R ");

        // Rebased onto an opened subdirectory; entries above it are dropped
        // rather than handed out as paths that cannot resolve against the root.
        let scoped = parse_status_porcelain(
            " M packages/app/src/main.ts\n?? packages/app/new.ts\n M other/pkg/x.ts\n",
            "packages/app/",
        );
        assert_eq!(
            scoped.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(),
            vec!["src/main.ts", "new.ts"]
        );
    }

    #[test]
    fn status_from_a_subdirectory_is_scoped_and_root_relative() {
        let root = scratch_repo("scoped-status");
        std::fs::create_dir_all(root.join("packages/app/src")).unwrap();
        std::fs::create_dir_all(root.join("elsewhere")).unwrap();
        std::fs::write(root.join("packages/app/src/main.ts"), "a\n").unwrap();
        std::fs::write(root.join("elsewhere/other.ts"), "b\n").unwrap();
        std::fs::write(root.join("top-level.ts"), "c\n").unwrap();

        // Opening the subdirectory must not report — or scan — the rest of the
        // repository, and its paths must resolve against the opened folder.
        let scoped = status_porcelain(&root.join("packages/app")).unwrap();
        assert_eq!(
            scoped.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(),
            vec!["src/main.ts"]
        );

        // At the repository root nothing changes.
        let full = status_porcelain(&root).unwrap();
        let mut paths = full.iter().map(|e| e.path.as_str()).collect::<Vec<_>>();
        paths.sort_unstable();
        assert_eq!(
            paths,
            vec![
                "elsewhere/other.ts",
                "packages/app/src/main.ts",
                "top-level.ts"
            ]
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn per_path_status_does_not_depend_on_the_rest_of_the_tree() {
        let root = scratch_repo("path-status");
        std::fs::write(root.join("tracked.txt"), "one\n").unwrap();
        run_git(&root, &["add", "tracked.txt"]).unwrap();
        run_git(&root, &["commit", "-m", "baseline"]).unwrap();
        std::fs::write(root.join("tracked.txt"), "two\n").unwrap();
        std::fs::write(root.join("fresh.txt"), "new\n").unwrap();
        // A filename with glob characters must be matched literally.
        std::fs::write(root.join("odd[1].txt"), "new\n").unwrap();

        assert!(status_xy_for_path(&root, "tracked.txt").contains('M'));
        assert_eq!(status_xy_for_path(&root, "fresh.txt"), "??");
        assert_eq!(status_xy_for_path(&root, "odd[1].txt"), "??");
        assert_eq!(status_xy_for_path(&root, "never-existed.txt"), "");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn diff_from_a_subdirectory_root_still_finds_the_head_baseline() {
        let root = scratch_repo("subdir-diff");
        let package = root.join("packages/app");
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(package.join("main.ts"), "before\n").unwrap();
        run_git(&root, &["add", "--all"]).unwrap();
        run_git(&root, &["commit", "-m", "baseline"]).unwrap();
        std::fs::write(package.join("main.ts"), "after\nmore\n").unwrap();

        // Opened root is a subdirectory: a tracked, modified file must not be
        // mistaken for a new one just because HEAD lookups defaulted to the
        // repository root.
        let result = diff_file(&package, "main.ts", "HEAD").unwrap();
        assert_eq!(result.status, "modified");
        assert_eq!(result.before, "before\n");
        assert_eq!(result.after, "after\nmore\n");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn oversized_files_report_a_diff_without_inlining_their_contents() {
        let root = scratch_repo("oversized");
        std::fs::write(root.join("big.txt"), "seed\n").unwrap();
        run_git(&root, &["add", "big.txt"]).unwrap();
        run_git(&root, &["commit", "-m", "baseline"]).unwrap();
        std::fs::write(
            root.join("big.txt"),
            "y\n".repeat(MAX_DIFF_TEXT_BYTES / 2 + 16),
        )
        .unwrap();

        let result = diff_file(&root, "big.txt", "HEAD").unwrap();
        assert_eq!(result.status, "modified");
        assert!(result.before.is_empty());
        assert!(result.after.is_empty());
        assert!(!result.summary.available);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn controlled_commit_stages_all_and_uses_stdin_message() {
        let root = std::env::temp_dir().join(format!(
            "glyphra-commit-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        run_git(&root, &["init"]).unwrap();
        run_git(&root, &["config", "user.name", "Glyphra Test"]).unwrap();
        run_git(&root, &["config", "user.email", "test@glyphra.local"]).unwrap();
        std::fs::write(root.join("file.txt"), "first\n").unwrap();

        let result = commit_all(&root, "test: controlled commit\n\nbody").unwrap();
        assert!(!result.hash.is_empty());
        assert!(result.summary.contains("controlled commit"));
        assert!(status_porcelain(&root).unwrap().is_empty());
        assert_eq!(
            run_git(&root, &["log", "-1", "--pretty=%B"])
                .unwrap()
                .trim(),
            "test: controlled commit\n\nbody"
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
