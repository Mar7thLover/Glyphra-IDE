use std::sync::Arc;

use tauri::{ipc::Channel, State, Window};

use crate::search::{SearchBatch, SearchManager};

#[tauri::command]
pub fn search_start(
    window: Window,
    manager: State<'_, Arc<SearchManager>>,
    root: String,
    query: String,
    channel: Channel<SearchBatch>,
) -> Result<u32, String> {
    manager.start(window.label(), root, query, channel)
}

#[tauri::command]
pub fn search_cancel(
    window: Window,
    manager: State<'_, Arc<SearchManager>>,
    search_id: u32,
) -> Result<(), String> {
    manager.cancel(window.label(), search_id)
}
