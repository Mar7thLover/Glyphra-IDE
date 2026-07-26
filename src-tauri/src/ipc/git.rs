use crate::gitx::cli::{self, GitCommitResult, GitFileDiff, GitFileStatus};

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
