use crate::gitx::cli::{self, GitFileDiff, GitFileStatus};

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
