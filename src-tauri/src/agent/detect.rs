use std::process::Command;

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/AgentDetectInfo.ts")]
pub struct AgentDetectInfo {
    pub backend: String,
    pub installed: bool,
    pub detail: String,
}

pub fn detect_agents() -> Vec<AgentDetectInfo> {
    vec![
        probe(
            "codex-acp",
            "Codex CLI + ACP adapter",
            &[("codex", &["--version"]), ("npx", &["--version"])],
        ),
        probe(
            "claude-acp",
            "Claude Code + ACP adapter",
            &[("claude", &["--version"]), ("npx", &["--version"])],
        ),
        probe(
            "pi-agent",
            "Pi Coding Agent (pi / npx)",
            &[("pi", &["--version"]), ("npx", &["--version"])],
        ),
        AgentDetectInfo {
            backend: "custom-agent".into(),
            installed: true,
            detail: "Custom command / fixture harness always available.".into(),
        },
        AgentDetectInfo {
            backend: "fixture".into(),
            installed: which("node").is_some(),
            detail: if which("node").is_some() {
                "Node available for fixture replay-agent.".into()
            } else {
                "Node.js ≥ 20 required for fixture replay.".into()
            },
        },
    ]
}

fn probe(backend: &str, label: &str, commands: &[(&str, &[&str])]) -> AgentDetectInfo {
    let mut found = Vec::new();
    for (bin, args) in commands {
        if let Some(version) = run_version(bin, args) {
            found.push(format!("{bin} {version}"));
        }
    }
    if found.is_empty() {
        AgentDetectInfo {
            backend: backend.into(),
            installed: false,
            detail: format!("{label}: not detected on PATH"),
        }
    } else {
        AgentDetectInfo {
            backend: backend.into(),
            installed: true,
            detail: format!("{label}: {}", found.join(" · ")),
        }
    }
}

fn run_version(bin: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(bin).args(args).output().ok()?;
    if !output.status.success() && output.stdout.is_empty() && output.stderr.is_empty() {
        return None;
    }
    let text = if !output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stdout)
    } else {
        String::from_utf8_lossy(&output.stderr)
    };
    let line = text.lines().next()?.trim();
    if line.is_empty() {
        None
    } else {
        Some(line.chars().take(80).collect())
    }
}

pub fn which(bin: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(bin);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            let exe = dir.join(format!("{bin}.exe"));
            if exe.is_file() {
                return Some(exe);
            }
            let cmd = dir.join(format!("{bin}.cmd"));
            if cmd.is_file() {
                return Some(cmd);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_returns_known_backends() {
        let infos = detect_agents();
        let backends: Vec<_> = infos.iter().map(|i| i.backend.as_str()).collect();
        assert!(backends.contains(&"codex-acp"));
        assert!(backends.contains(&"custom-agent"));
        assert!(backends.contains(&"fixture"));
    }
}
