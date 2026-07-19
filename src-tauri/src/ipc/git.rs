use crate::gitx::cli::{self, GitFileStatus};

#[tauri::command]
pub fn git_status(project_path: String) -> Result<Vec<GitFileStatus>, String> {
    let root = cli::project_root(&project_path)?;
    cli::status_porcelain(&root)
}

#[tauri::command]
pub fn git_exec_readonly(project_path: String, args: Vec<String>) -> Result<String, String> {
    let root = cli::project_root(&project_path)?;
    cli::exec_readonly(&root, &args)
}
