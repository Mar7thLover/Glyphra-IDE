//! Git worktrees, so several agents can work one repository in parallel.
//!
//! Each worktree is an ordinary checkout with its own path, which means it also
//! gets its own project window, its own agent supervisor entry, and — because
//! the checkpoint engine keys its shadow repository by workspace path — its own
//! independent checkpoint history. Nothing here has to coordinate with those.
//!
//! Worktrees live under Glyphra's app data directory rather than inside the
//! user's repository, so a stray `git add .` in the primary checkout can never
//! sweep one up.

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::cli::run_git;

/// Keep a lid on how many parallel checkouts one repository can accumulate;
/// each one is a full copy of the working tree.
const MAX_WORKTREES: usize = 24;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/GitWorktree.ts")]
pub struct GitWorktree {
    pub path: String,
    /// Short branch name, or `None` when the checkout is detached.
    pub branch: Option<String>,
    pub head: Option<String>,
    pub detached: bool,
    pub locked: bool,
    pub prunable: bool,
    /// The checkout the repository was originally opened from.
    pub is_primary: bool,
}

/// Parse `git worktree list --porcelain`. Records are blank-line separated and
/// the primary checkout is always first.
pub fn parse_worktree_list(stdout: &str) -> Vec<GitWorktree> {
    let mut worktrees = Vec::new();
    let mut current: Option<GitWorktree> = None;

    for line in stdout.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            if let Some(entry) = current.take() {
                worktrees.push(entry);
            }
            continue;
        }
        let (key, value) = match line.split_once(' ') {
            Some((key, value)) => (key, value.trim()),
            None => (line, ""),
        };
        match key {
            "worktree" => {
                if let Some(entry) = current.take() {
                    worktrees.push(entry);
                }
                current = Some(GitWorktree {
                    path: crate::paths::simplified_str(value),
                    branch: None,
                    head: None,
                    detached: false,
                    locked: false,
                    prunable: false,
                    is_primary: false,
                });
            }
            "HEAD" => {
                if let Some(entry) = current.as_mut() {
                    entry.head = Some(value.to_owned());
                }
            }
            "branch" => {
                if let Some(entry) = current.as_mut() {
                    entry.branch = Some(value.trim_start_matches("refs/heads/").to_owned());
                }
            }
            "detached" => {
                if let Some(entry) = current.as_mut() {
                    entry.detached = true;
                }
            }
            "locked" => {
                if let Some(entry) = current.as_mut() {
                    entry.locked = true;
                }
            }
            "prunable" => {
                if let Some(entry) = current.as_mut() {
                    entry.prunable = true;
                }
            }
            _ => {}
        }
    }
    if let Some(entry) = current.take() {
        worktrees.push(entry);
    }
    if let Some(first) = worktrees.first_mut() {
        first.is_primary = true;
    }
    worktrees
}

pub fn list(project: &Path) -> Result<Vec<GitWorktree>, String> {
    Ok(parse_worktree_list(&run_git(
        project,
        &["worktree", "list", "--porcelain"],
    )?))
}

/// Reduce a user-supplied name to something safe as both a branch name and a
/// single directory segment.
pub fn sanitize_name(name: &str) -> Option<String> {
    let mut output = String::new();
    let mut previous_dash = false;
    for character in name.trim().chars() {
        let keep =
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | '/') {
                character
            } else if character.is_whitespace() {
                '-'
            } else {
                continue;
            };
        // `..` and `//` are the two sequences git refuses and path traversal
        // relies on, so collapse anything repeated.
        if matches!(keep, '-' | '.' | '/') {
            if previous_dash {
                continue;
            }
            previous_dash = true;
        } else {
            previous_dash = false;
        }
        output.push(keep);
        if output.len() >= 64 {
            break;
        }
    }
    let trimmed = output.trim_matches(|c| c == '-' || c == '.' || c == '/');
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_owned())
}

fn directory_segment(branch: &str) -> String {
    branch.replace('/', "-")
}

fn branch_exists(project: &Path, branch: &str) -> bool {
    run_git(
        project,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
    )
    .is_ok()
}

/// Create a worktree under `root` for `name`.
///
/// An existing branch is checked out as-is; otherwise a new branch is created
/// from `base` (or `HEAD`). Returns the freshly created entry.
pub fn add(
    project: &Path,
    root: &Path,
    name: &str,
    base: Option<&str>,
) -> Result<GitWorktree, String> {
    let branch = sanitize_name(name).ok_or("worktree name must contain letters or digits")?;
    let existing = list(project)?;
    if existing.len() >= MAX_WORKTREES {
        return Err(format!(
            "this repository already has {} worktrees",
            existing.len()
        ));
    }
    if existing
        .iter()
        .any(|entry| entry.branch.as_deref() == Some(branch.as_str()))
    {
        return Err(format!(
            "branch {branch} is already checked out in a worktree"
        ));
    }

    let target = root.join(directory_segment(&branch));
    if target.exists() {
        return Err(format!("{} already exists", target.display()));
    }
    fs::create_dir_all(root).map_err(|err| format!("create worktree root: {err}"))?;

    let target_arg = target.to_string_lossy().to_string();
    if branch_exists(project, &branch) {
        run_git(project, &["worktree", "add", &target_arg, &branch])?;
    } else {
        let base = base.unwrap_or("HEAD");
        run_git(
            project,
            &["worktree", "add", "-b", &branch, &target_arg, base],
        )?;
    }

    list(project)?
        .into_iter()
        .find(|entry| entry.branch.as_deref() == Some(branch.as_str()))
        .ok_or_else(|| format!("git did not report the new worktree for {branch}"))
}

/// Remove a worktree git currently reports. The primary checkout is refused —
/// removing it would take the repository with it.
pub fn remove(project: &Path, path: &str, force: bool) -> Result<(), String> {
    let wanted = crate::paths::simplified_str(path).replace('\\', "/");
    let entry = list(project)?
        .into_iter()
        .find(|entry| entry.path.replace('\\', "/").eq_ignore_ascii_case(&wanted))
        .ok_or("that path is not a worktree of this repository")?;
    if entry.is_primary {
        return Err("the primary checkout cannot be removed".into());
    }
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&entry.path);
    run_git(project, &args)?;
    let _ = run_git(project, &["worktree", "prune"]);
    Ok(())
}

pub fn worktree_root(data_dir: &Path, project: &Path) -> PathBuf {
    data_dir
        .join("worktrees")
        .join(super::checkpoints::project_key(project))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_porcelain_listing() {
        let stdout = concat!(
            "worktree /repo\n",
            "HEAD abc123\n",
            "branch refs/heads/main\n",
            "\n",
            "worktree /repo-worktrees/feature\n",
            "HEAD def456\n",
            "branch refs/heads/feature/one\n",
            "locked\n",
            "\n",
            "worktree /repo-worktrees/loose\n",
            "HEAD 999999\n",
            "detached\n",
            "prunable gitdir file points to non-existent location\n",
            "\n",
        );
        let entries = parse_worktree_list(stdout);
        assert_eq!(entries.len(), 3);

        assert!(entries[0].is_primary);
        assert_eq!(entries[0].branch.as_deref(), Some("main"));

        assert!(!entries[1].is_primary);
        assert_eq!(entries[1].branch.as_deref(), Some("feature/one"));
        assert!(entries[1].locked);

        assert!(entries[2].detached);
        assert!(entries[2].prunable);
        assert_eq!(entries[2].branch, None);
    }

    #[test]
    fn tolerates_a_listing_without_a_trailing_blank_line() {
        let entries = parse_worktree_list("worktree /repo\nHEAD abc\nbranch refs/heads/main");
        assert_eq!(entries.len(), 1);
        assert!(entries[0].is_primary);
    }

    #[test]
    fn sanitizes_names_into_safe_branch_and_directory_segments() {
        assert_eq!(
            sanitize_name("Fix login bug").as_deref(),
            Some("Fix-login-bug")
        );
        assert_eq!(
            sanitize_name("feature/auth").as_deref(),
            Some("feature/auth")
        );
        assert_eq!(
            sanitize_name("  ../../etc/passwd  ").as_deref(),
            Some("etc/passwd")
        );
        assert_eq!(sanitize_name("a..b").as_deref(), Some("a.b"));
        assert_eq!(sanitize_name("x//y").as_deref(), Some("x/y"));
        assert_eq!(sanitize_name("!!!").as_deref(), None);
        assert_eq!(sanitize_name("   ").as_deref(), None);
        assert!(sanitize_name(&"a".repeat(200)).unwrap().len() <= 64);
    }

    #[test]
    fn directory_segments_never_nest() {
        assert_eq!(directory_segment("feature/auth"), "feature-auth");
    }
}
