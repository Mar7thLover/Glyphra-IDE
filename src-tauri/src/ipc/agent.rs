use std::sync::Arc;

use tauri::{ipc::Channel, AppHandle, State, Window};

use crate::agent::{
    catalog::{self, AgentCatalogRequest, AgentHarnessCatalog},
    detect::{detect_agents, AgentDetectInfo},
    runtime::{detect_runtime, RuntimeDetectInfo},
    supervisor::{AgentIoEvent, AgentSpawnRequest, AgentSupervisor},
};

#[tauri::command]
pub async fn agent_catalog(
    app: AppHandle,
    request: AgentCatalogRequest,
) -> Result<AgentHarnessCatalog, String> {
    catalog::load(&app, request).await
}

#[tauri::command]
pub fn agent_detect() -> Vec<AgentDetectInfo> {
    detect_agents()
}

#[tauri::command]
pub fn runtime_detect() -> RuntimeDetectInfo {
    detect_runtime()
}

#[tauri::command]
pub async fn agent_spawn(
    app: AppHandle,
    window: Window,
    supervisor: State<'_, Arc<AgentSupervisor>>,
    request: AgentSpawnRequest,
    channel: Channel<AgentIoEvent>,
) -> Result<u32, String> {
    supervisor
        .spawn(&app, window.label(), request, channel)
        .await
}

#[tauri::command]
pub async fn agent_write(
    window: Window,
    supervisor: State<'_, Arc<AgentSupervisor>>,
    session_id: u32,
    line: String,
) -> Result<(), String> {
    supervisor
        .write_line(window.label(), session_id, line)
        .await
}

#[tauri::command]
pub async fn agent_kill(
    window: Window,
    supervisor: State<'_, Arc<AgentSupervisor>>,
    session_id: u32,
) -> Result<(), String> {
    supervisor.kill(window.label(), session_id).await
}
