use std::sync::Arc;

use tauri::{ipc::Channel, State};

use crate::agent::{
    detect::{detect_agents, AgentDetectInfo},
    supervisor::{AgentIoEvent, AgentSpawnRequest, AgentSupervisor},
};

#[tauri::command]
pub fn agent_detect() -> Vec<AgentDetectInfo> {
    detect_agents()
}

#[tauri::command]
pub async fn agent_spawn(
    supervisor: State<'_, Arc<AgentSupervisor>>,
    request: AgentSpawnRequest,
    channel: Channel<AgentIoEvent>,
) -> Result<u32, String> {
    supervisor.spawn(request, channel).await
}

#[tauri::command]
pub async fn agent_write(
    supervisor: State<'_, Arc<AgentSupervisor>>,
    session_id: u32,
    line: String,
) -> Result<(), String> {
    supervisor.write_line(session_id, line).await
}

#[tauri::command]
pub async fn agent_kill(
    supervisor: State<'_, Arc<AgentSupervisor>>,
    session_id: u32,
) -> Result<(), String> {
    supervisor.kill(session_id).await
}
