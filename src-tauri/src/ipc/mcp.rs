use tauri::AppHandle;

use crate::mcp::{self, McpServerRecord, McpServerUpsert};

#[tauri::command]
pub fn mcp_servers_list(app: AppHandle) -> Result<Vec<McpServerRecord>, String> {
    mcp::list(&app)
}

#[tauri::command]
pub fn mcp_servers_upsert(
    app: AppHandle,
    server: McpServerUpsert,
) -> Result<McpServerRecord, String> {
    let record = mcp::upsert(&app, server)?;
    tracing::info!(
        target: "audit",
        action = "mcp_server_upsert",
        id = %record.id,
        name = %record.name,
        enabled = record.enabled
    );
    Ok(record)
}

#[tauri::command]
pub fn mcp_servers_remove(app: AppHandle, id: String) -> Result<(), String> {
    mcp::remove(&app, &id)?;
    tracing::info!(target: "audit", action = "mcp_server_remove", id = %id);
    Ok(())
}
