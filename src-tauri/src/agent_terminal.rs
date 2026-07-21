//! ACP `terminal/*` sessions — pipe-backed command runners (not interactive PTYs).
//! Agents use these for builds/tests; the user-facing terminal remains `pty.rs`.

use std::{
    collections::HashMap,
    io::Read,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/AgentTermCreateRequest.ts")]
pub struct AgentTermCreateRequest {
    pub command: String,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub env: Vec<AgentTermEnvVar>,
    pub output_byte_limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/AgentTermEnvVar.ts")]
pub struct AgentTermEnvVar {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/AgentTermOutput.ts")]
pub struct AgentTermOutput {
    pub output: String,
    pub truncated: bool,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
}

struct LiveTerm {
    output: Arc<Mutex<String>>,
    truncated: Arc<Mutex<bool>>,
    exit_code: Arc<Mutex<Option<i32>>>,
    child: Mutex<Option<Child>>,
}

#[derive(Default)]
pub struct AgentTerminalManager {
    next_id: AtomicU32,
    sessions: Mutex<HashMap<String, Arc<LiveTerm>>>,
}

impl AgentTerminalManager {
    pub fn create(&self, request: AgentTermCreateRequest) -> Result<String, String> {
        let mut cmd = Command::new(&request.command);
        cmd.args(&request.args);
        if let Some(cwd) = request.cwd.as_deref().filter(|value| !value.is_empty()) {
            cmd.current_dir(cwd);
        }
        for env in &request.env {
            cmd.env(&env.name, &env.value);
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|err| format!("spawn `{}`: {err}", request.command))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let limit = request
            .output_byte_limit
            .map(|value| value as usize)
            .unwrap_or(1024 * 1024)
            .max(1024);

        let output = Arc::new(Mutex::new(String::new()));
        let truncated = Arc::new(Mutex::new(false));
        let exit_code = Arc::new(Mutex::new(None));

        let out_buf = Arc::clone(&output);
        let trunc_flag = Arc::clone(&truncated);
        if let Some(mut pipe) = stdout {
            thread::spawn(move || pump_pipe(&mut pipe, &out_buf, &trunc_flag, limit));
        }
        let err_buf = Arc::clone(&output);
        let err_trunc = Arc::clone(&truncated);
        if let Some(mut pipe) = stderr {
            thread::spawn(move || pump_pipe(&mut pipe, &err_buf, &err_trunc, limit));
        }

        let live = Arc::new(LiveTerm {
            output,
            truncated,
            exit_code: Arc::clone(&exit_code),
            child: Mutex::new(Some(child)),
        });

        let wait_live = Arc::clone(&live);
        thread::spawn(move || {
            let status = {
                let mut guard = match wait_live.child.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                match guard.as_mut() {
                    Some(child) => child.wait().ok(),
                    None => None,
                }
            };
            if let Some(status) = status {
                if let Ok(mut code) = wait_live.exit_code.lock() {
                    *code = status.code().or(Some(1));
                }
            }
        });

        let id = format!("term-{}", self.next_id.fetch_add(1, Ordering::Relaxed) + 1);
        self.sessions
            .lock()
            .map_err(|_| "agent terminal lock poisoned".to_string())?
            .insert(id.clone(), live);
        Ok(id)
    }

    #[cfg(test)]
    pub fn session_count(&self) -> usize {
        self.sessions.lock().map(|s| s.len()).unwrap_or(0)
    }

    pub fn output(&self, terminal_id: &str) -> Result<AgentTermOutput, String> {
        let live = self.get(terminal_id)?;
        snapshot(&live)
    }

    pub fn wait_for_exit(&self, terminal_id: &str) -> Result<AgentTermOutput, String> {
        let live = self.get(terminal_id)?;
        for _ in 0..7500 {
            if live
                .exit_code
                .lock()
                .map_err(|_| "exit lock poisoned".to_string())?
                .is_some()
            {
                return snapshot(&live);
            }
            thread::sleep(Duration::from_millis(40));
        }
        Err(format!("timed out waiting for terminal `{terminal_id}`"))
    }

    pub fn kill(&self, terminal_id: &str) -> Result<(), String> {
        let live = self.get(terminal_id)?;
        if let Some(child) = live
            .child
            .lock()
            .map_err(|_| "child lock poisoned".to_string())?
            .as_mut()
        {
            let _ = child.kill();
        }
        if let Ok(mut code) = live.exit_code.lock() {
            if code.is_none() {
                *code = Some(1);
            }
        }
        Ok(())
    }

    pub fn release(&self, terminal_id: &str) -> Result<(), String> {
        let live = {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| "agent terminal lock poisoned".to_string())?;
            sessions.remove(terminal_id)
        };
        if let Some(live) = live {
            if let Some(mut child) = live
                .child
                .lock()
                .map_err(|_| "child lock poisoned".to_string())?
                .take()
            {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        Ok(())
    }

    fn get(&self, terminal_id: &str) -> Result<Arc<LiveTerm>, String> {
        self.sessions
            .lock()
            .map_err(|_| "agent terminal lock poisoned".to_string())?
            .get(terminal_id)
            .cloned()
            .ok_or_else(|| format!("unknown terminal `{terminal_id}`"))
    }
}

fn snapshot(live: &LiveTerm) -> Result<AgentTermOutput, String> {
    Ok(AgentTermOutput {
        output: live
            .output
            .lock()
            .map_err(|_| "output lock poisoned".to_string())?
            .clone(),
        truncated: *live
            .truncated
            .lock()
            .map_err(|_| "truncated lock poisoned".to_string())?,
        exit_code: *live
            .exit_code
            .lock()
            .map_err(|_| "exit lock poisoned".to_string())?,
        signal: None,
    })
}

fn pump_pipe(
    pipe: &mut impl Read,
    output: &Arc<Mutex<String>>,
    truncated: &Arc<Mutex<bool>>,
    limit: usize,
) {
    let mut buf = [0u8; 4096];
    loop {
        match pipe.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let chunk = String::from_utf8_lossy(&buf[..n]);
                if let Ok(mut guard) = output.lock() {
                    guard.push_str(&chunk);
                    if guard.len() > limit {
                        let drain = guard.len() - limit;
                        let mut cut = drain;
                        while cut < guard.len() && !guard.is_char_boundary(cut) {
                            cut += 1;
                        }
                        guard.drain(..cut);
                        if let Ok(mut flag) = truncated.lock() {
                            *flag = true;
                        }
                    }
                }
            }
            Err(_) => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_wait_release_echo() {
        let manager = AgentTerminalManager::default();
        let id = manager
            .create(AgentTermCreateRequest {
                command: "echo".into(),
                args: vec!["glyphra-term".into()],
                cwd: None,
                env: vec![],
                output_byte_limit: Some(4096),
            })
            .expect("create");
        let waited = manager.wait_for_exit(&id).expect("wait");
        assert_eq!(waited.exit_code, Some(0));
        assert!(waited.output.contains("glyphra-term"));
        manager.release(&id).expect("release");
        assert_eq!(manager.session_count(), 0);
    }
}
