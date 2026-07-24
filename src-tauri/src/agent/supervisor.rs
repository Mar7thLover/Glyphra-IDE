use std::{collections::HashMap, process::Stdio, sync::Arc};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin},
    sync::Mutex,
};
use ts_rs::TS;

use tauri::AppHandle;

use super::{
    framing::drain_lines,
    job::{self, JobGuard},
    recorder::{Direction, SessionRecorder},
};
use crate::{process_ext::tokio_command, providers, runtime_resources};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/AgentSpawnRequest.ts")]
pub struct AgentSpawnRequest {
    pub backend: String,
    pub cwd: String,
    /// Harness wire protocol. ACP is passed through; other protocols use the
    /// bundled normalizing bridge and still appear as ACP to the frontend.
    pub protocol: Option<String>,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub endpoint: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub context_window: Option<u32>,
    #[serde(default)]
    pub fast_mode: bool,
    pub approval_reviewer: Option<String>,
    /// Native thread prepared during catalog loading, when supported.
    pub prewarmed_session_id: Option<String>,
    /// Optional Glyphra provider id — secrets/CODEX_CONFIG injected at spawn.
    pub provider_id: Option<String>,
    /// Permission preset: `safe` (request) | `standard` (auto) | `unleashed` (full).
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/AgentIoEvent.ts")]
pub struct AgentIoEvent {
    /// u32 (not u64) so ts-rs emits `number` instead of `bigint`.
    pub session_id: u32,
    pub kind: String,
    pub data: String,
}

struct LiveAgent {
    child: Child,
    stdin: ChildStdin,
    /// Windows Job Object (KILL_ON_JOB_CLOSE); no-op guard elsewhere.
    _job: JobGuard,
    recorder: Option<Arc<SessionRecorder>>,
}

#[derive(Default)]
pub struct AgentSupervisor {
    next_id: std::sync::atomic::AtomicU32,
    agents: Mutex<HashMap<u32, LiveAgent>>,
}

impl AgentSupervisor {
    pub fn next_session_id(&self) -> u32 {
        self.next_id
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            + 1
    }

    pub async fn spawn(
        self: &Arc<Self>,
        app: &AppHandle,
        request: AgentSpawnRequest,
        channel: Channel<AgentIoEvent>,
    ) -> Result<u32, String> {
        let (program, args) = resolve_command(app, &request)?;
        let session_id = self.next_session_id();

        let mut command = tokio_command(&program);
        command
            .args(&args)
            .current_dir(&request.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut env = request.env.clone();
        if let Some(provider_id) = &request.provider_id {
            let injected = providers::materialize_spawn_env(app, provider_id)?;
            env.extend(injected);
        }
        if let Some(mode) = request.mode.as_deref() {
            env.insert(
                "INITIAL_AGENT_MODE".into(),
                match mode {
                    "safe" => "request-approval".into(),
                    "unleashed" => "full-access".into(),
                    _ => "auto-approval".into(),
                },
            );
        }
        for (key, value) in &env {
            command.env(key, value);
        }

        let mut child = command
            .spawn()
            .map_err(|err| format!("failed to spawn {program}: {err}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "missing agent stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "missing agent stderr".to_string())?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "missing agent stdin".to_string())?;

        // Best-effort: orphans are still cleaned by kill_on_drop if job attach fails.
        let job_guard = job::attach(&child).unwrap_or_else(|err| {
            tracing::warn!(target: "agent", session_id, error = %err, "job attach failed");
            JobGuard::detached()
        });

        let recorder =
            SessionRecorder::maybe_from_env(app, session_id, &request.backend).map(Arc::new);

        {
            let mut agents = self.agents.lock().await;
            agents.insert(
                session_id,
                LiveAgent {
                    child,
                    stdin,
                    _job: job_guard,
                    recorder: recorder.clone(),
                },
            );
        }

        let supervisor = Arc::clone(self);
        let out_channel = channel.clone();
        let out_recorder = recorder.clone();
        tokio::spawn(async move {
            pump_stdout(session_id, stdout, out_channel, out_recorder).await;
        });

        let err_channel = channel.clone();
        let err_recorder = recorder;
        tokio::spawn(async move {
            pump_stderr(session_id, stderr, err_channel, err_recorder).await;
        });

        let wait_supervisor = Arc::clone(&supervisor);
        let wait_channel = channel;
        tokio::spawn(async move {
            // Never await child exit while holding the agents map lock. Writes and
            // kills need the same lock, so doing so deadlocks every live session.
            let code = loop {
                let poll = {
                    let mut agents = wait_supervisor.agents.lock().await;
                    match agents.get_mut(&session_id) {
                        Some(agent) => agent.child.try_wait(),
                        None => break "missing".into(),
                    }
                };

                match poll {
                    Ok(Some(status)) => {
                        break status
                            .code()
                            .map(|code| code.to_string())
                            .unwrap_or_else(|| "signal".into());
                    }
                    Ok(None) => tokio::time::sleep(std::time::Duration::from_millis(25)).await,
                    Err(err) => break format!("wait-error:{err}"),
                }
            };
            let _ = wait_channel.send(AgentIoEvent {
                session_id,
                kind: "exit".into(),
                data: code,
            });
            wait_supervisor.agents.lock().await.remove(&session_id);
        });

        Ok(session_id)
    }

    pub async fn write_line(&self, session_id: u32, line: String) -> Result<(), String> {
        let mut agents = self.agents.lock().await;
        let agent = agents
            .get_mut(&session_id)
            .ok_or_else(|| format!("unknown agent session {session_id}"))?;
        let payload = if line.ends_with('\n') {
            line
        } else {
            format!("{line}\n")
        };
        if let Some(recorder) = &agent.recorder {
            recorder.record(Direction::In, payload.trim_end_matches(['\r', '\n']));
        }
        agent
            .stdin
            .write_all(payload.as_bytes())
            .await
            .map_err(|err| format!("failed to write agent stdin: {err}"))?;
        agent
            .stdin
            .flush()
            .await
            .map_err(|err| format!("failed to flush agent stdin: {err}"))?;
        Ok(())
    }

    pub async fn kill(&self, session_id: u32) -> Result<(), String> {
        let mut agents = self.agents.lock().await;
        let Some(mut agent) = agents.remove(&session_id) else {
            return Ok(());
        };
        let _ = agent.child.start_kill();
        Ok(())
    }
}

fn resolve_command(
    app: &AppHandle,
    request: &AgentSpawnRequest,
) -> Result<(String, Vec<String>), String> {
    let protocol = request.protocol.as_deref().unwrap_or("acp");
    let is_http = matches!(
        protocol,
        "openai-responses" | "openai-chat" | "anthropic-messages"
    );
    if request.command.is_some() || is_http {
        let command = request.command.as_deref().unwrap_or("");
        if command.trim().is_empty() && !is_http {
            return Err("custom agent command is empty".into());
        }
        if protocol == "acp" {
            return Ok((command.into(), request.args.clone()));
        }

        let bridge = runtime_resources::resolve(app, "harness-bridge.mjs")?;
        let mut args = vec![
            bridge.to_string_lossy().to_string(),
            format!("--protocol={protocol}"),
            format!("--command={command}"),
            format!(
                "--args={}",
                serde_json::to_string(&request.args)
                    .map_err(|err| format!("serialize harness args: {err}"))?
            ),
        ];
        if let Some(endpoint) = request.endpoint.as_deref().filter(|v| !v.trim().is_empty()) {
            args.push(format!("--endpoint={endpoint}"));
        }
        if let Some(model) = request.model.as_deref().filter(|v| !v.trim().is_empty()) {
            args.push(format!("--model={model}"));
        }
        if let Some(effort) = request
            .reasoning_effort
            .as_deref()
            .filter(|v| !v.trim().is_empty())
        {
            args.push(format!("--reasoning-effort={effort}"));
        }
        if let Some(context_window) = request.context_window {
            args.push(format!("--context-window={context_window}"));
        }
        if request.fast_mode {
            args.push("--fast-mode=1".into());
        }
        if let Some(reviewer) = request
            .approval_reviewer
            .as_deref()
            .filter(|v| !v.trim().is_empty())
        {
            args.push(format!("--approval-reviewer={reviewer}"));
        }
        if let Some(session_id) = request
            .prewarmed_session_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            args.push(format!("--prewarmed-session-id={session_id}"));
        }
        return Ok(("node".into(), args));
    }

    match request.backend.as_str() {
        "codex-acp" => Ok((
            "npx".into(),
            vec!["-y".into(), "@agentclientprotocol/codex-acp".into()],
        )),
        "claude-acp" => Ok((
            "npx".into(),
            vec!["-y".into(), "@agentclientprotocol/claude-agent-acp".into()],
        )),
        "pi-agent" => Ok((
            "npx".into(),
            vec!["-y".into(), "@earendil-works/pi-coding-agent".into()],
        )),
        "fixture" => {
            let script = runtime_resources::resolve(app, "replay-agent.mjs")?;
            let mut args = vec![script.to_string_lossy().to_string()];
            if let Ok(tape) = runtime_resources::resolve(app, "demo-edit-turn.jsonl") {
                args.push(format!("--tape={}", tape.display()));
            }
            Ok(("node".into(), args))
        }
        "custom-agent" => Err("custom-agent requires an explicit command".into()),
        other => Err(format!("unknown agent backend: {other}")),
    }
}

async fn pump_stdout(
    session_id: u32,
    stdout: impl tokio::io::AsyncRead + Unpin,
    channel: Channel<AgentIoEvent>,
    recorder: Option<Arc<SessionRecorder>>,
) {
    let mut reader = BufReader::new(stdout);
    let mut pending = Vec::new();
    let mut buf = [0u8; 8192];
    loop {
        match tokio::io::AsyncReadExt::read(&mut reader, &mut buf).await {
            Ok(0) => break,
            Ok(n) => {
                for line in drain_lines(&mut pending, &buf[..n]) {
                    if let Some(recorder) = &recorder {
                        recorder.record(Direction::Out, &line);
                    }
                    let _ = channel.send(AgentIoEvent {
                        session_id,
                        kind: "stdout".into(),
                        data: line,
                    });
                }
            }
            Err(_) => break,
        }
    }
}

async fn pump_stderr(
    session_id: u32,
    stderr: impl tokio::io::AsyncRead + Unpin,
    channel: Channel<AgentIoEvent>,
    recorder: Option<Arc<SessionRecorder>>,
) {
    let mut reader = BufReader::new(stderr);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break,
            Ok(_) => {
                let data = line.trim_end_matches(['\r', '\n']).to_string();
                if data.is_empty() {
                    continue;
                }
                if let Some(recorder) = &recorder {
                    recorder.record(Direction::Err, &data);
                }
                let _ = channel.send(AgentIoEvent {
                    session_id,
                    kind: "stderr".into(),
                    data,
                });
            }
            Err(_) => break,
        }
    }
}
