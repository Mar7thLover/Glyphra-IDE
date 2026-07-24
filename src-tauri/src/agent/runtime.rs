use serde::Serialize;
use ts_rs::TS;

use super::detect::which;
use crate::process_ext::std_command;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/RuntimeDetectInfo.ts")]
pub struct RuntimeDetectInfo {
    pub node: ToolStatus,
    pub npm: ToolStatus,
    pub npx: ToolStatus,
    pub git: ToolStatus,
    pub os: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/ToolStatus.ts")]
pub struct ToolStatus {
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

pub fn detect_runtime() -> RuntimeDetectInfo {
    RuntimeDetectInfo {
        node: probe_tool("node", &["--version"]),
        npm: probe_tool("npm", &["--version"]),
        npx: probe_tool("npx", &["--version"]),
        git: probe_tool("git", &["--version"]),
        os: std::env::consts::OS.into(),
    }
}

fn probe_tool(bin: &str, args: &[&str]) -> ToolStatus {
    let path = which(bin).map(|p| p.to_string_lossy().to_string());
    let version = run_version(bin, args);
    ToolStatus {
        name: bin.into(),
        installed: path.is_some() || version.is_some(),
        version,
        path,
    }
}

fn run_version(bin: &str, args: &[&str]) -> Option<String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_detect_reports_os() {
        let info = detect_runtime();
        assert!(!info.os.is_empty());
        assert_eq!(info.node.name, "node");
        assert_eq!(info.git.name, "git");
    }
}
