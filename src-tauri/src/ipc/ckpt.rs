use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::gitx::checkpoints::{CheckpointEngine, CkptFileContents, CkptTurnMeta};

#[tauri::command]
pub fn ckpt_begin_turn(
    app: AppHandle,
    engine: State<'_, Arc<CheckpointEngine>>,
    project_path: String,
    label: Option<String>,
) -> Result<CkptTurnMeta, String> {
    engine.begin_turn(&app, &project_path, label)
}

#[tauri::command]
pub fn ckpt_preimage(
    app: AppHandle,
    engine: State<'_, Arc<CheckpointEngine>>,
    project_path: String,
    path: String,
) -> Result<(), String> {
    engine.preimage(&app, &project_path, &path)
}

#[tauri::command]
pub fn ckpt_commit_turn(
    app: AppHandle,
    engine: State<'_, Arc<CheckpointEngine>>,
    project_path: String,
    turn_id: Option<String>,
) -> Result<CkptTurnMeta, String> {
    engine.commit_turn(&app, &project_path, turn_id)
}

#[tauri::command]
pub fn ckpt_list_turns(
    app: AppHandle,
    engine: State<'_, Arc<CheckpointEngine>>,
    project_path: String,
) -> Result<Vec<CkptTurnMeta>, String> {
    engine.list_turns(&app, &project_path)
}

#[tauri::command]
pub fn ckpt_file_contents(
    app: AppHandle,
    engine: State<'_, Arc<CheckpointEngine>>,
    project_path: String,
    turn_id: String,
    path: String,
) -> Result<CkptFileContents, String> {
    engine.file_contents(&app, &project_path, &turn_id, &path)
}

#[tauri::command]
pub fn ckpt_restore_turn(
    app: AppHandle,
    engine: State<'_, Arc<CheckpointEngine>>,
    project_path: String,
    turn_id: String,
) -> Result<CkptTurnMeta, String> {
    engine.restore_turn(&app, &project_path, &turn_id)
}

#[tauri::command]
pub fn ckpt_restore_file(
    app: AppHandle,
    engine: State<'_, Arc<CheckpointEngine>>,
    project_path: String,
    turn_id: String,
    path: String,
) -> Result<(), String> {
    engine.restore_file(&app, &project_path, &turn_id, &path)
}

#[tauri::command]
pub fn ckpt_write_file(project_path: String, path: String, content: String) -> Result<(), String> {
    CheckpointEngine::write_file_content(&project_path, &path, &content)
}
