use std::sync::Arc;

use tauri::{ipc::Channel, State};

use crate::pty::{PtyEvent, PtyManager};

#[tauri::command]
pub fn pty_open(
    manager: State<'_, Arc<PtyManager>>,
    cwd: String,
    cols: u16,
    rows: u16,
    channel: Channel<PtyEvent>,
) -> Result<u32, String> {
    manager.open(cwd, cols, rows, channel)
}

#[tauri::command]
pub fn pty_write(
    manager: State<'_, Arc<PtyManager>>,
    pty_id: u32,
    data: String,
) -> Result<(), String> {
    manager.write(pty_id, data)
}

#[tauri::command]
pub fn pty_resize(
    manager: State<'_, Arc<PtyManager>>,
    pty_id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(pty_id, cols, rows)
}

#[tauri::command]
pub fn pty_close(manager: State<'_, Arc<PtyManager>>, pty_id: u32) -> Result<(), String> {
    manager.close(pty_id)
}
