use std::sync::Arc;

use tauri::{ipc::Channel, State, Window};

use crate::search::{ReplaceSummary, SearchBatch, SearchManager, SearchOptions};

#[tauri::command]
pub fn search_start(
    window: Window,
    manager: State<'_, Arc<SearchManager>>,
    roots: Vec<String>,
    query: String,
    options: SearchOptions,
    channel: Channel<SearchBatch>,
) -> Result<u32, String> {
    manager.start(window.label(), roots, query, options, channel)
}

#[tauri::command]
pub async fn search_replace(
    manager: State<'_, Arc<SearchManager>>,
    roots: Vec<String>,
    query: String,
    replacement: String,
    options: SearchOptions,
) -> Result<ReplaceSummary, String> {
    let manager = Arc::clone(manager.inner());
    tauri::async_runtime::spawn_blocking(move || {
        manager.replace(roots, query, replacement, options)
    })
    .await
    .map_err(|err| format!("search replace task failed: {err}"))?
}

#[tauri::command]
pub fn search_cancel(
    window: Window,
    manager: State<'_, Arc<SearchManager>>,
    search_id: u32,
) -> Result<(), String> {
    manager.cancel(window.label(), search_id)
}
