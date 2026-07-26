use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::gitx::checkpoints::{CheckpointEngine, CkptFileContents, CkptHunkSummary, CkptTurnMeta};

#[tauri::command]
pub async fn ckpt_begin_turn(
    app: AppHandle,
    engine: State<'_, Arc<CheckpointEngine>>,
    project_path: String,
    label: Option<String>,
) -> Result<CkptTurnMeta, String> {
    let engine = Arc::clone(engine.inner());
    tauri::async_runtime::spawn_blocking(move || engine.begin_turn(&app, &project_path, label))
        .await
        .map_err(|err| format!("checkpoint begin task failed: {err}"))?
}

#[tauri::command]
pub async fn ckpt_preimage(
    app: AppHandle,
    engine: State<'_, Arc<CheckpointEngine>>,
    project_path: String,
    path: String,
) -> Result<(), String> {
    let engine = Arc::clone(engine.inner());
    tauri::async_runtime::spawn_blocking(move || engine.preimage(&app, &project_path, &path))
        .await
        .map_err(|err| format!("checkpoint preimage task failed: {err}"))?
}

#[tauri::command]
pub async fn ckpt_commit_turn(
    app: AppHandle,
    engine: State<'_, Arc<CheckpointEngine>>,
    project_path: String,
    turn_id: Option<String>,
) -> Result<CkptTurnMeta, String> {
    let engine = Arc::clone(engine.inner());
    tauri::async_runtime::spawn_blocking(move || engine.commit_turn(&app, &project_path, turn_id))
        .await
        .map_err(|err| format!("checkpoint commit task failed: {err}"))?
}

#[tauri::command]
pub async fn ckpt_list_turns(
    app: AppHandle,
    engine: State<'_, Arc<CheckpointEngine>>,
    project_path: String,
) -> Result<Vec<CkptTurnMeta>, String> {
    let engine = Arc::clone(engine.inner());
    tauri::async_runtime::spawn_blocking(move || engine.list_turns(&app, &project_path))
        .await
        .map_err(|err| format!("checkpoint listing task failed: {err}"))?
}

#[tauri::command]
pub async fn ckpt_file_contents(
    app: AppHandle,
    engine: State<'_, Arc<CheckpointEngine>>,
    project_path: String,
    turn_id: String,
    path: String,
) -> Result<CkptFileContents, String> {
    let engine = Arc::clone(engine.inner());
    tauri::async_runtime::spawn_blocking(move || {
        engine.file_contents(&app, &project_path, &turn_id, &path)
    })
    .await
    .map_err(|err| format!("checkpoint read task failed: {err}"))?
}

#[tauri::command]
pub async fn ckpt_hunks(
    app: AppHandle,
    engine: State<'_, Arc<CheckpointEngine>>,
    project_path: String,
    turn_id: String,
    path: String,
) -> Result<CkptHunkSummary, String> {
    let engine = Arc::clone(engine.inner());
    tauri::async_runtime::spawn_blocking(move || engine.hunks(&app, &project_path, &turn_id, &path))
        .await
        .map_err(|err| format!("checkpoint diff task failed: {err}"))?
}

#[tauri::command]
pub async fn ckpt_restore_turn(
    app: AppHandle,
    engine: State<'_, Arc<CheckpointEngine>>,
    project_path: String,
    turn_id: String,
) -> Result<CkptTurnMeta, String> {
    let engine = Arc::clone(engine.inner());
    tauri::async_runtime::spawn_blocking(move || engine.restore_turn(&app, &project_path, &turn_id))
        .await
        .map_err(|err| format!("checkpoint restore task failed: {err}"))?
}

#[tauri::command]
pub async fn ckpt_restore_file(
    app: AppHandle,
    engine: State<'_, Arc<CheckpointEngine>>,
    project_path: String,
    turn_id: String,
    path: String,
) -> Result<(), String> {
    let engine = Arc::clone(engine.inner());
    tauri::async_runtime::spawn_blocking(move || {
        engine.restore_file(&app, &project_path, &turn_id, &path)
    })
    .await
    .map_err(|err| format!("checkpoint file restore task failed: {err}"))?
}

#[tauri::command]
pub async fn ckpt_write_file(
    project_path: String,
    path: String,
    content: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        CheckpointEngine::write_file_content(&project_path, &path, &content)
    })
    .await
    .map_err(|err| format!("checkpoint write task failed: {err}"))?
}
