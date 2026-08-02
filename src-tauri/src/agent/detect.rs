use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::process_ext::std_command;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/AgentDetectInfo.ts")]
pub struct AgentDetectInfo {
    pub backend: String,
    pub label: String,
    /// True only when the harness itself (or fixture runtime) is present.
    pub installed: bool,
    pub detail: String,
    /// Wire protocol Glyphra should use for this harness.
    pub protocol: String,
    /// Resolved executable path. The frontend passes this back when starting.
    pub command: Option<String>,
    pub args: Vec<String>,
}

pub fn detect_agents() -> Vec<AgentDetectInfo> {
    vec![
        probe_harness(
            "codex-acp",
            "Codex CLI",
            "codex",
            &["--version"],
            "codex-app-server",
            vec![],
            "Install Codex CLI; Glyphra talks to its native app-server directly.",
        ),
        probe_harness(
            "claude-acp",
            "Claude Code",
            "claude",
            &["--version"],
            "claude-stream-json",
            vec![],
            "Install Claude Code; Glyphra uses its native stream-json interface.",
        ),
        probe_harness(
            "pi-agent",
            "Pi Coding Agent",
            "pi",
            &["--version"],
            "pi-json",
            vec![],
            "Install Pi Coding Agent; Glyphra uses its native JSON mode.",
        ),
        probe_harness(
            "opencode-acp",
            "OpenCode",
            "opencode",
            &["--version"],
            "acp",
            vec!["acp".into()],
            "Install OpenCode; its built-in ACP server needs no adapter.",
        ),
        AgentDetectInfo {
            backend: "custom-agent".into(),
            label: "Custom harness".into(),
            installed: false,
            detail: "Add an ACP, JSONL, shell, or HTTP harness in Agent settings.".into(),
            protocol: "acp".into(),
            command: None,
            args: vec![],
        },
        AgentDetectInfo {
            backend: "fixture".into(),
            label: "Offline fixture".into(),
            installed: which("node").is_some(),
            detail: if which("node").is_some() {
                "Offline fixture agent (Node). Good for UI/workflow tests.".into()
            } else {
                "Node.js 20 or newer is required for fixture replay.".into()
            },
            protocol: "acp".into(),
            command: None,
            args: vec![],
        },
    ]
}

fn probe_harness(
    backend: &str,
    label: &str,
    bin: &str,
    version_args: &[&str],
    protocol: &str,
    launch_args: Vec<String>,
    missing_hint: &str,
) -> AgentDetectInfo {
    if let Some(path) = which(bin) {
        let version = run_version(&path, version_args).unwrap_or_else(|| "version unknown".into());
        if !supports_protocol(&path, protocol) {
            return AgentDetectInfo {
                backend: backend.into(),
                label: label.into(),
                installed: false,
                detail: format!("{label}: {version}, but this build does not expose {protocol}."),
                protocol: protocol.into(),
                command: None,
                args: launch_args,
            };
        }
        return AgentDetectInfo {
            backend: backend.into(),
            label: label.into(),
            installed: true,
            detail: format!("{label}: {version} · direct {protocol}"),
            protocol: protocol.into(),
            command: Some(path.to_string_lossy().to_string()),
            args: launch_args,
        };
    }

    AgentDetectInfo {
        backend: backend.into(),
        label: label.into(),
        installed: false,
        detail: format!("{label}: not found. {missing_hint}"),
        protocol: protocol.into(),
        command: None,
        args: launch_args,
    }
}

fn supports_protocol(bin: &Path, protocol: &str) -> bool {
    let args: &[&str] = match protocol {
        "codex-app-server" => &["app-server", "--help"],
        "acp" => &["acp", "--help"],
        _ => &["--help"],
    };
    std_command(bin)
        .args(args)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn run_version(bin: &Path, args: &[&str]) -> Option<String> {
    let output = std_command(bin).args(args).output().ok()?;
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
        #[cfg(windows)]
        {
            // npm and similar installers drop an extensionless POSIX shim
            // (`#!/bin/sh`) next to the real launcher. CreateProcess cannot
            // execute that shim, so prefer real Windows launchers first and
            // keep the bare file only as a last resort.
            for extension in ["exe", "cmd", "bat", "com"] {
                let candidate = dir.join(format!("{bin}.{extension}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
        let candidate = dir.join(bin);
        if candidate.is_file() {
            return Some(candidate);
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
        assert!(backends.contains(&"opencode-acp"));
        assert!(backends.contains(&"custom-agent"));
        assert!(backends.contains(&"fixture"));
        let custom = infos.iter().find(|i| i.backend == "custom-agent").unwrap();
        assert!(!custom.installed);
    }

    #[test]
    fn installed_harnesses_have_commands_and_protocols() {
        let infos = detect_agents();
        for info in infos
            .iter()
            .filter(|info| info.installed && info.backend != "fixture")
        {
            assert!(info.command.is_some());
            assert!(!info.protocol.is_empty());
        }
        let fixture = infos.iter().find(|i| i.backend == "fixture").unwrap();
        assert_eq!(fixture.installed, which("node").is_some());
    }

    #[test]
    fn which_prefers_windows_launcher_shims_over_extensionless_files() {
        let temp = std::env::temp_dir().join(format!("glyphra-which-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).expect("create temp dir");

        // A POSIX shim (npm style) and a real .cmd launcher side by side.
        let shim = temp.join("opencode");
        std::fs::write(&shim, "#!/bin/sh\n").expect("write shim");
        let cmd_shim = temp.join("opencode.cmd");
        std::fs::write(&cmd_shim, "@echo off\n").expect("write cmd shim");

        let old_path = std::env::var_os("PATH");
        let mut path =
            std::env::split_paths(&old_path.clone().unwrap_or_default()).collect::<Vec<_>>();
        path.insert(0, temp.clone());
        std::env::set_var("PATH", std::env::join_paths(&path).expect("join PATH"));

        let found = which("opencode");

        #[cfg(windows)]
        {
            // Must resolve to the executable .cmd shim, never the bare script.
            assert_eq!(found, Some(cmd_shim));
        }
        #[cfg(not(windows))]
        {
            assert_eq!(found, Some(shim));
        }

        let _ = std::fs::remove_dir_all(&temp);
        match old_path {
            Some(value) => std::env::set_var("PATH", value),
            None => std::env::remove_var("PATH"),
        }
    }
}
