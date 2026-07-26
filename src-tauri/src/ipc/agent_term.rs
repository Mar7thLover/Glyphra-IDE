use std::sync::Arc;

use tauri::{State, Window};

use crate::agent_terminal::{AgentTermCreateRequest, AgentTermOutput, AgentTerminalManager};

#[tauri::command]
pub fn agent_term_create(
    window: Window,
    manager: State<'_, Arc<AgentTerminalManager>>,
    request: AgentTermCreateRequest,
) -> Result<String, String> {
    manager.create(window.label(), request)
}

#[tauri::command]
pub fn agent_term_output(
    window: Window,
    manager: State<'_, Arc<AgentTerminalManager>>,
    terminal_id: String,
) -> Result<AgentTermOutput, String> {
    manager.output(window.label(), &terminal_id)
}

#[tauri::command]
pub async fn agent_term_wait(
    window: Window,
    manager: State<'_, Arc<AgentTerminalManager>>,
    terminal_id: String,
) -> Result<AgentTermOutput, String> {
    let manager = Arc::clone(manager.inner());
    let window_label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || manager.wait_for_exit(&window_label, &terminal_id))
        .await
        .map_err(|err| format!("wait join: {err}"))?
}

#[tauri::command]
pub fn agent_term_kill(
    window: Window,
    manager: State<'_, Arc<AgentTerminalManager>>,
    terminal_id: String,
) -> Result<(), String> {
    manager.kill(window.label(), &terminal_id)
}

#[tauri::command]
pub fn agent_term_release(
    window: Window,
    manager: State<'_, Arc<AgentTerminalManager>>,
    terminal_id: String,
) -> Result<(), String> {
    manager.release(window.label(), &terminal_id)
}
