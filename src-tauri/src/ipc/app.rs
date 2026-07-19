use serde::Serialize;
use tauri::{State, Window};
use ts_rs::TS;

use crate::perf::Launch;

#[derive(Serialize, Clone, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/EnvInfo.ts")]
pub struct EnvInfo {
    pub os: String,
    pub mica: bool,
    pub version: String,
}

/// First call from the frontend after mount. Reveals the (initially hidden)
/// window so users never see an unstyled flash, and reports environment facts
/// the UI needs to pick its rendering mode.
#[tauri::command]
pub fn app_ready(window: Window, launch: State<'_, Launch>) -> EnvInfo {
    tracing::info!(
        target: "perf",
        phase = "frontend_ready",
        elapsed_ms = launch.0.elapsed().as_millis() as u64
    );

    let mica = mica_supported();
    // Win10: strip Mica effects so the opaque CSS shell shows through.
    #[cfg(windows)]
    if !mica {
        let _ = window.set_effects(None::<()>);
    }

    let _ = window.show();
    let _ = window.set_focus();

    EnvInfo {
        os: std::env::consts::OS.into(),
        mica,
        version: env!("CARGO_PKG_VERSION").into(),
    }
}

/// Frontend-side startup phase marker (e.g. "tti") funneled into tracing.
#[tauri::command]
pub fn perf_mark(name: String, launch: State<'_, Launch>) {
    tracing::info!(
        target: "perf",
        phase = %name,
        elapsed_ms = launch.0.elapsed().as_millis() as u64
    );
}

#[cfg(windows)]
fn mica_supported() -> bool {
    // Mica requires Windows 11 (build 22000+); older builds fall back to
    // opaque theme colors on the frontend.
    windows_version::OsVersion::current().build >= 22000
}

#[cfg(not(windows))]
fn mica_supported() -> bool {
    false
}
