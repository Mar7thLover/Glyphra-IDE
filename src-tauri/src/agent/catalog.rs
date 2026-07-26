use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use ts_rs::TS;

use crate::{process_ext::tokio_command, providers, runtime_resources};

#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/AgentCatalogRequest.ts")]
pub struct AgentCatalogRequest {
    pub protocol: String,
    pub command: String,
    pub args: Vec<String>,
    pub cwd: String,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub context_window: Option<u32>,
    #[serde(default)]
    pub fast_mode: bool,
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/AgentReasoningEffort.ts")]
pub struct AgentReasoningEffort {
    pub id: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/AgentModelInfo.ts")]
pub struct AgentModelInfo {
    pub id: String,
    pub label: String,
    pub description: String,
    pub reasoning_efforts: Vec<AgentReasoningEffort>,
    pub default_reasoning_effort: Option<String>,
    pub supports_fast_mode: bool,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/AgentPermissionProfile.ts")]
pub struct AgentPermissionProfile {
    pub id: String,
    pub description: String,
    pub allowed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/AgentSkillInfo.ts")]
pub struct AgentSkillInfo {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/AgentMcpServerInfo.ts")]
pub struct AgentMcpServerInfo {
    pub name: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/AgentHarnessCatalog.ts")]
pub struct AgentHarnessCatalog {
    pub models: Vec<AgentModelInfo>,
    pub default_model: Option<String>,
    pub context_window: Option<u32>,
    pub supports_context_window: bool,
    pub supports_auto_review: bool,
    pub sandbox_status: String,
    pub prewarmed_session_id: Option<String>,
    pub permission_profiles: Vec<AgentPermissionProfile>,
    pub skills: Vec<AgentSkillInfo>,
    pub mcp_servers: Vec<AgentMcpServerInfo>,
}

pub async fn load(
    app: &AppHandle,
    request: AgentCatalogRequest,
) -> Result<AgentHarnessCatalog, String> {
    if request.command.trim().is_empty() {
        return Err("harness catalog command is empty".into());
    }
    let bridge = runtime_resources::resolve(app, "harness-bridge.mjs")?;
    let cwd = crate::paths::simplified_str(&request.cwd);

    let mut command = tokio_command("node");
    command
        .arg(bridge)
        .arg("--catalog=1")
        .arg(format!("--protocol={}", request.protocol))
        .arg(format!("--command={}", request.command))
        .arg(format!(
            "--args={}",
            serde_json::to_string(&request.args)
                .map_err(|err| format!("serialize catalog args: {err}"))?
        ))
        .arg(format!("--cwd={cwd}"))
        .current_dir(&cwd)
        .kill_on_drop(true);

    if let Some(model) = request.model.as_deref().filter(|value| !value.is_empty()) {
        command.arg(format!("--model={model}"));
    }
    if let Some(effort) = request
        .reasoning_effort
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        command.arg(format!("--reasoning-effort={effort}"));
    }
    if let Some(context_window) = request.context_window {
        command.arg(format!("--context-window={context_window}"));
    }
    if request.fast_mode {
        command.arg("--fast-mode=1");
    }
    if let Some(mode) = request.mode.as_deref() {
        command.env(
            "INITIAL_AGENT_MODE",
            match mode {
                "safe" => "request-approval",
                "unleashed" => "full-access",
                _ => "auto-approval",
            },
        );
    }

    if let Some(provider_id) = request.provider_id {
        command.envs(providers::materialize_spawn_env(app, &provider_id)?);
    }

    let output = tokio::time::timeout(Duration::from_secs(45), command.output())
        .await
        .map_err(|_| "harness catalog timed out".to_string())?
        .map_err(|err| format!("start harness catalog: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "harness catalog failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|err| format!("parse harness catalog: {err}"))
}
