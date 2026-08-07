use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::paths;

const RUNTIME_DIR: &str = "runtime";

/// Resolve a bundled runtime script.
///
/// The result is always a plain path: `resource_dir()` is extended-length on
/// Windows, and Node cannot load a `\\?\`-prefixed main module — it fails in
/// `realpathSync` and exits(1) before running anything.
pub fn resolve(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|err| format!("resolve application resources: {err}"))?
        .join(RUNTIME_DIR)
        .join(name);
    if packaged.is_file() {
        return Ok(paths::simplified(&packaged));
    }

    // Development and Rust-only test builds run directly from src-tauri.
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(RUNTIME_DIR)
        .join(name);
    if development.is_file() {
        return Ok(paths::simplified(&development));
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
        for name in ["harness-bridge.mjs", "codex-app-server-daemon.mjs"] {
            assert!(root.join(name).is_file(), "missing runtime resource {name}");
        }
    }
}
