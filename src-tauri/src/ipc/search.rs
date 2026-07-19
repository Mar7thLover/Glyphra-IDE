use std::sync::Arc;

use tauri::{ipc::Channel, State};

use crate::search::{SearchBatch, SearchManager};

#[tauri::command]
pub fn search_start(
    manager: State<'_, Arc<SearchManager>>,
    root: String,
    query: String,
    channel: Channel<SearchBatch>,
) -> Result<u32, String> {
    manager.start(root, query, channel)
}

#[tauri::command]
pub fn search_cancel(manager: State<'_, Arc<SearchManager>>, search_id: u32) -> Result<(), String> {
    manager.cancel(search_id)
}
