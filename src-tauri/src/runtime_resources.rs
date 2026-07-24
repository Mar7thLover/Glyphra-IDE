use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const RUNTIME_DIR: &str = "runtime";

pub fn resolve(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|err| format!("resolve application resources: {err}"))?
        .join(RUNTIME_DIR)
        .join(name);
    if packaged.is_file() {
        return Ok(packaged);
    }

    // Development and Rust-only test builds run directly from src-tauri.
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(RUNTIME_DIR)
        .join(name);
    if development.is_file() {
        return Ok(development);
    }

    Err(format!(
        "bundled runtime resource `{name}` is missing (looked at {})",
        packaged.display()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_runtime_payload_is_present() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(RUNTIME_DIR);
        for name in [
            "harness-bridge.mjs",
            "codex-app-server-daemon.mjs",
            "replay-agent.mjs",
            "demo-edit-turn.jsonl",
        ] {
            assert!(root.join(name).is_file(), "missing runtime resource {name}");
        }
    }
}
