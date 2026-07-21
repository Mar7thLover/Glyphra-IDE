use std::sync::Arc;

use tauri::State;

use crate::agent_terminal::{
    AgentTermCreateRequest, AgentTermOutput, AgentTerminalManager,
};

#[tauri::command]
pub fn agent_term_create(
    manager: State<'_, Arc<AgentTerminalManager>>,
    request: AgentTermCreateRequest,
) -> Result<String, String> {
    manager.create(request)
}

#[tauri::command]
pub fn agent_term_output(
    manager: State<'_, Arc<AgentTerminalManager>>,
    terminal_id: String,
) -> Result<AgentTermOutput, String> {
    manager.output(&terminal_id)
}

#[tauri::command]
pub async fn agent_term_wait(
    manager: State<'_, Arc<AgentTerminalManager>>,
    terminal_id: String,
) -> Result<AgentTermOutput, String> {
    let manager = Arc::clone(manager.inner());
    tauri::async_runtime::spawn_blocking(move || manager.wait_for_exit(&terminal_id))
        .await
        .map_err(|err| format!("wait join: {err}"))?
}

#[tauri::command]
pub fn agent_term_kill(
    manager: State<'_, Arc<AgentTerminalManager>>,
    terminal_id: String,
) -> Result<(), String> {
    manager.kill(&terminal_id)
}

#[tauri::command]
pub fn agent_term_release(
    manager: State<'_, Arc<AgentTerminalManager>>,
    terminal_id: String,
) -> Result<(), String> {
    manager.release(&terminal_id)
}
