use serde::Serialize;
use tauri::{Manager, State, Window};
use ts_rs::TS;

use crate::perf::Launch;

pub const AGENT_WINDOW_LABEL: &str = "agent";

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
        let _ = window.set_effects(None::<tauri::utils::config::WindowEffectsConfig>);
    }

    let _ = window.show();
    let _ = window.set_focus();

    EnvInfo {
        os: std::env::consts::OS.into(),
        mica,
        version: env!("CARGO_PKG_VERSION").into(),
    }
}

/// Open (or focus) the standalone Agents window. The frontend routes on the
/// window label; the window reveals itself via `app_ready` once mounted.
/// Async on purpose: building webview windows from a sync command can
/// deadlock on Windows (wry#583).
#[tauri::command]
pub async fn window_open_agent(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(AGENT_WINDOW_LABEL) {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        AGENT_WINDOW_LABEL,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Glyphra Agents")
    .inner_size(1000.0, 700.0)
    .min_inner_size(600.0, 440.0)
    .center()
    .visible(false)
    .decorations(false)
    .transparent(true);

    if mica_supported() {
        builder = builder.effects(tauri::utils::config::WindowEffectsConfig {
            effects: vec![tauri::utils::WindowEffect::Mica],
            state: None,
            radius: None,
            color: None,
        });
    }

    builder.build().map_err(|error| error.to_string())?;
    Ok(())
}

/// Focus the main IDE window from the Agents window.
#[tauri::command]
pub fn window_focus_main(app: tauri::AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let _ = main.show();
    let _ = main.unminimize();
    let _ = main.set_focus();
    Ok(())
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
