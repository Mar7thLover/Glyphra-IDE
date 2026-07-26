use tauri::{AppHandle, Manager};

use crate::gitx::{
    cli::{self, GitCommitResult, GitFileDiff, GitFileStatus},
    worktree::{self, GitWorktree},
};

#[tauri::command]
pub async fn git_status(project_path: String) -> Result<Vec<GitFileStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = cli::project_root(&project_path)?;
        cli::status_porcelain(&root)
    })
    .await
    .map_err(|err| format!("git status task failed: {err}"))?
}

#[tauri::command]
pub async fn git_exec_readonly(project_path: String, args: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = cli::project_root(&project_path)?;
        cli::exec_readonly(&root, &args)
    })
    .await
    .map_err(|err| format!("git task failed: {err}"))?
}

#[tauri::command]
pub async fn git_diff_file(
    project_path: String,
    path: String,
    base: String,
) -> Result<GitFileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = cli::project_root(&project_path)?;
        cli::diff_file(&root, &path, &base)
    })
    .await
    .map_err(|err| format!("git diff task failed: {err}"))?
}

#[tauri::command]
pub async fn git_worktree_list(project_path: String) -> Result<Vec<GitWorktree>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = cli::project_root(&project_path)?;
        worktree::list(&root)
    })
    .await
    .map_err(|err| format!("git worktree task failed: {err}"))?
}

#[tauri::command]
pub async fn git_worktree_add(
    app: AppHandle,
    project_path: String,
    name: String,
    base: Option<String>,
) -> Result<GitWorktree, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("app data dir: {err}"))?;
    let audit_path = project_path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let root = cli::project_root(&project_path)?;
        let worktrees = worktree::worktree_root(&data_dir, &root);
        worktree::add(&root, &worktrees, &name, base.as_deref())
    })
    .await
    .map_err(|err| format!("git worktree task failed: {err}"))?;
    match &result {
        Ok(entry) => tracing::info!(
            project_path = %audit_path,
            worktree = %entry.path,
            branch = entry.branch.as_deref().unwrap_or("-"),
            "worktree created"
        ),
        Err(error) => tracing::warn!(
            project_path = %audit_path,
            error = %error,
            "worktree creation failed"
        ),
    }
    result
}

#[tauri::command]
pub async fn git_worktree_remove(
    project_path: String,
    path: String,
    force: bool,
) -> Result<Vec<GitWorktree>, String> {
    let audit_path = path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let root = cli::project_root(&project_path)?;
        worktree::remove(&root, &path, force)?;
        worktree::list(&root)
    })
    .await
    .map_err(|err| format!("git worktree task failed: {err}"))?;
    match &result {
        Ok(_) => tracing::info!(worktree = %audit_path, force, "worktree removed"),
        Err(error) => {
            tracing::warn!(worktree = %audit_path, error = %error, "worktree removal failed")
        }
    }
    result
}

#[tauri::command]
pub async fn git_commit(project_path: String, message: String) -> Result<GitCommitResult, String> {
    let audit_path = project_path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let root = cli::project_root(&project_path)?;
        cli::commit_all(&root, &message)
    })
    .await
    .map_err(|err| format!("git commit task failed: {err}"))?;
    match &result {
        Ok(commit) => tracing::info!(
            project_path = %audit_path,
            commit_hash = %commit.hash,
            "controlled git commit completed"
        ),
        Err(error) => tracing::warn!(
            project_path = %audit_path,
            error = %error,
            "controlled git commit failed"
        ),
    }
    result
}
