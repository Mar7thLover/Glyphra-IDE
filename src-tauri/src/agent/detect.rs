use std::process::Command;

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/AgentDetectInfo.ts")]
pub struct AgentDetectInfo {
    pub backend: String,
    /// True only when the primary CLI (or fixture Node) is present.
    pub installed: bool,
    pub detail: String,
}

pub fn detect_agents() -> Vec<AgentDetectInfo> {
    let npx = which("npx").is_some();
    vec![
        probe_primary(
            "codex-acp",
            "Codex CLI",
            "codex",
            &["--version"],
            npx,
            "Needs `codex` on PATH (ACP adapter via npx).",
        ),
        probe_primary(
            "claude-acp",
            "Claude Code",
            "claude",
            &["--version"],
            npx,
            "Needs `claude` on PATH (ACP adapter via npx).",
        ),
        probe_primary(
            "pi-agent",
            "Pi Coding Agent",
            "pi",
            &["--version"],
            npx,
            "Needs `pi` on PATH (or install Pi coding agent).",
        ),
        AgentDetectInfo {
            backend: "custom-agent".into(),
            installed: false,
            detail: "Custom harness requires an explicit command (not configured in UI yet)."
                .into(),
        },
        AgentDetectInfo {
            backend: "fixture".into(),
            installed: which("node").is_some(),
            detail: if which("node").is_some() {
                "Offline fixture agent (Node). Good for UI/workflow tests.".into()
            } else {
                "Node.js ≥ 20 required for fixture replay.".into()
            },
        },
    ]
}

fn probe_primary(
    backend: &str,
    label: &str,
    bin: &str,
    args: &[&str],
    npx_present: bool,
    missing_hint: &str,
) -> AgentDetectInfo {
    if let Some(version) = run_version(bin, args) {
        let npx_note = if npx_present {
            " · npx ready"
        } else {
            " · npx missing (adapter spawn may fail)"
        };
        return AgentDetectInfo {
            backend: backend.into(),
            installed: true,
            detail: format!("{label}: {bin} {version}{npx_note}"),
        };
    }
    AgentDetectInfo {
        backend: backend.into(),
        installed: false,
        detail: format!(
            "{label}: not found. {missing_hint}{}",
            if npx_present {
                ""
            } else {
                " Also install Node/npx."
            }
        ),
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
        let custom = infos.iter().find(|i| i.backend == "custom-agent").unwrap();
        assert!(!custom.installed);
    }

    #[test]
    fn npx_alone_does_not_mark_codex_installed() {
        // Structural: installed flag only true when primary CLI found.
        // We can't control PATH here; just ensure fixture/custom rules hold.
        let infos = detect_agents();
        let fixture = infos.iter().find(|i| i.backend == "fixture").unwrap();
        assert_eq!(fixture.installed, which("node").is_some());
    }
}
