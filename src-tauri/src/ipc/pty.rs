use std::sync::Arc;

use tauri::{ipc::Channel, State, Window};

use crate::pty::{PtyEvent, PtyManager};

#[tauri::command]
pub fn pty_open(
    window: Window,
    manager: State<'_, Arc<PtyManager>>,
    cwd: String,
    cols: u16,
    rows: u16,
    channel: Channel<PtyEvent>,
) -> Result<u32, String> {
    manager.open(window.label(), cwd, cols, rows, channel)
}

#[tauri::command]
pub fn pty_write(
    window: Window,
    manager: State<'_, Arc<PtyManager>>,
    pty_id: u32,
    data: String,
) -> Result<(), String> {
    manager.write(window.label(), pty_id, data)
}

#[tauri::command]
pub fn pty_resize(
    window: Window,
    manager: State<'_, Arc<PtyManager>>,
    pty_id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(window.label(), pty_id, cols, rows)
}

#[tauri::command]
pub fn pty_close(
    window: Window,
    manager: State<'_, Arc<PtyManager>>,
    pty_id: u32,
) -> Result<(), String> {
    manager.close(window.label(), pty_id)
}
