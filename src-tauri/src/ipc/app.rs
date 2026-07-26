use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Emitter, Manager, State, Window};
use ts_rs::TS;

use crate::{
    agent::supervisor::AgentSupervisor, agent_terminal::AgentTerminalManager, perf::Launch,
    pty::PtyManager, search::SearchManager,
};

pub const AGENT_WINDOW_LABEL: &str = "agent";
pub const WELCOME_WINDOW_LABEL: &str = "main";
pub const LAUNCH_REQUEST_EVENT: &str = "launch-request";
pub const PREPARE_RESTART_EVENT: &str = "prepare-restart";

#[derive(Debug, Clone, Serialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/LaunchRequest.ts")]
pub struct LaunchRequest {
    pub project_path: String,
    pub file_path: Option<String>,
}

/// Bridges process arguments into the webview. Before the main frontend has
/// called `app_ready`, the newest request is retained so Explorer launches
/// cannot be lost during cold start.
pub struct LaunchState {
    pending: Mutex<Option<LaunchRequest>>,
    main_ready: AtomicBool,
}

impl LaunchState {
    pub fn new(initial: Option<LaunchRequest>) -> Self {
        Self {
            pending: Mutex::new(initial),
            main_ready: AtomicBool::new(false),
        }
    }

    fn mark_main_ready(&self) {
        self.main_ready.store(true, Ordering::Release);
    }

    fn is_main_ready(&self) -> bool {
        self.main_ready.load(Ordering::Acquire)
    }

    fn replace_pending(&self, request: LaunchRequest) {
        if let Ok(mut pending) = self.pending.lock() {
            *pending = Some(request);
        }
    }

    fn take_pending(&self) -> Option<LaunchRequest> {
        self.pending.lock().ok()?.take()
    }
}

#[derive(Deserialize)]
struct WorkspaceDescriptor {
    folder: Option<String>,
    folders: Option<Vec<WorkspaceFolder>>,
}

#[derive(Deserialize)]
struct WorkspaceFolder {
    path: String,
}

/// Converts `glyphra <folder-or-file>` into a project request. The first
/// argument is the executable, matching both `std::env::args` and the Tauri
/// single-instance plugin callback.
pub fn launch_request_from_args(args: &[String], cwd: &str) -> Option<LaunchRequest> {
    let candidate = args
        .iter()
        .skip(1)
        .find(|arg| !arg.starts_with('-') && !arg.trim().is_empty())?;
    let path = PathBuf::from(candidate);
    let path = if path.is_absolute() {
        path
    } else {
        Path::new(cwd).join(path)
    };
    resolve_launch_path(&path)
}

fn resolve_launch_path(path: &Path) -> Option<LaunchRequest> {
    let canonical = path.canonicalize().ok()?;
    if canonical.is_dir() {
        return Some(LaunchRequest {
            project_path: canonical.to_string_lossy().into_owned(),
            file_path: None,
        });
    }
    if !canonical.is_file() {
        return None;
    }

    if canonical
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.to_ascii_lowercase().ends_with(".glyphra-workspace"))
    {
        if let Some(project) = workspace_project(&canonical) {
            return Some(LaunchRequest {
                project_path: project.to_string_lossy().into_owned(),
                file_path: None,
            });
        }
    }

    let project = canonical.parent()?.canonicalize().ok()?;
    Some(LaunchRequest {
        project_path: project.to_string_lossy().into_owned(),
        file_path: Some(canonical.to_string_lossy().into_owned()),
    })
}

fn workspace_project(descriptor_path: &Path) -> Option<PathBuf> {
    let content = fs::read_to_string(descriptor_path).ok()?;
    let descriptor: WorkspaceDescriptor = serde_json::from_str(&content).ok()?;
    let folder = descriptor
        .folder
        .or_else(|| descriptor.folders?.into_iter().next().map(|item| item.path))
        .unwrap_or_else(|| ".".into());
    let folder = PathBuf::from(folder);
    let folder = if folder.is_absolute() {
        folder
    } else {
        descriptor_path.parent()?.join(folder)
    };
    let canonical = folder.canonicalize().ok()?;
    canonical.is_dir().then_some(canonical)
}

/// Called by `tauri-plugin-single-instance` for Explorer, file-association,
/// and terminal launches while Glyphra is already running.
pub fn handle_second_instance(app: &tauri::AppHandle, args: Vec<String>, cwd: String) {
    if let Some(request) = launch_request_from_args(&args, &cwd) {
        let main_exists = app.get_webview_window(WELCOME_WINDOW_LABEL).is_some();
        let delivered = main_exists
            && app
                .try_state::<LaunchState>()
                .is_some_and(|state| state.is_main_ready())
            && app
                .emit_to(WELCOME_WINDOW_LABEL, LAUNCH_REQUEST_EVENT, request.clone())
                .is_ok();
        if !delivered {
            if let Some(state) = app.try_state::<LaunchState>() {
                state.replace_pending(request);
            }
        }
        let main = match app.get_webview_window(WELCOME_WINDOW_LABEL) {
            Some(main) => Ok(main),
            None => open_welcome_window_impl(app),
        };
        match main {
            Ok(main) => {
                let _ = main.show();
                let _ = main.unminimize();
                let _ = main.set_focus();
            }
            Err(error) => tracing::warn!(target: "window", %error, "failed to open IDE window"),
        }
        return;
    }

    if let Some(main) = app.get_webview_window(WELCOME_WINDOW_LABEL) {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

fn open_welcome_window_impl(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window(WELCOME_WINDOW_LABEL) {
        return Ok(existing);
    }

    let builder = tauri::WebviewWindowBuilder::new(
        app,
        WELCOME_WINDOW_LABEL,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Glyphra")
    .inner_size(1280.0, 800.0)
    .min_inner_size(720.0, 480.0)
    .center()
    .visible(false);

    #[cfg(windows)]
    let builder = builder.decorations(false).transparent(true);
    #[cfg(not(windows))]
    let builder = builder.decorations(true);
    #[cfg(windows)]
    let builder = if mica_supported() {
        builder.effects(tauri::utils::config::WindowEffectsConfig {
            effects: vec![tauri::utils::WindowEffect::Mica],
            state: None,
            radius: None,
            color: None,
        })
    } else {
        builder
    };
    builder.build().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn window_open_project(
    app: tauri::AppHandle,
    project_path: String,
    file_path: Option<String>,
) -> Result<String, String> {
    let request = LaunchRequest {
        project_path,
        file_path,
    };
    let main_exists = app.get_webview_window(WELCOME_WINDOW_LABEL).is_some();
    let main = open_welcome_window_impl(&app)?;
    let delivered = main_exists
        && app
            .try_state::<LaunchState>()
            .is_some_and(|state| state.is_main_ready())
        && main.emit(LAUNCH_REQUEST_EVENT, request.clone()).is_ok();
    if !delivered {
        if let Some(state) = app.try_state::<LaunchState>() {
            state.replace_pending(request);
        }
    }
    let _ = main.show();
    let _ = main.unminimize();
    let _ = main.set_focus();
    Ok(WELCOME_WINDOW_LABEL.into())
}

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
pub fn app_ready(
    window: Window,
    launch: State<'_, Launch>,
    launch_state: State<'_, LaunchState>,
) -> EnvInfo {
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
    if window.label() == WELCOME_WINDOW_LABEL {
        launch_state.mark_main_ready();
    }
    EnvInfo {
        os: std::env::consts::OS.into(),
        mica,
        version: env!("CARGO_PKG_VERSION").into(),
    }
}

/// Returns the folder/file request captured during cold start, if any.
#[tauri::command]
pub fn app_take_launch_request(state: State<'_, LaunchState>) -> Option<LaunchRequest> {
    state.take_pending()
}

/// Gives every window a short, bounded opportunity to persist recovery state
/// and session archives before the updater replaces and restarts the process.
#[tauri::command]
pub async fn app_prepare_restart(app: tauri::AppHandle) -> Result<(), String> {
    app.emit(PREPARE_RESTART_EVENT, ())
        .map_err(|error| error.to_string())?;
    tokio::time::sleep(std::time::Duration::from_millis(750)).await;
    Ok(())
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

    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        AGENT_WINDOW_LABEL,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Glyphra Agents")
    .inner_size(1000.0, 700.0)
    .min_inner_size(600.0, 440.0)
    .center()
    .visible(false);

    // Transparent, frameless windows and Mica are a Windows-only shell choice.
    // Tauri does not expose `transparent` on this builder for every target.
    #[cfg(windows)]
    let builder = builder.decorations(false).transparent(true);
    #[cfg(not(windows))]
    let builder = builder.decorations(true);

    #[cfg(windows)]
    let builder = if mica_supported() {
        builder.effects(tauri::utils::config::WindowEffectsConfig {
            effects: vec![tauri::utils::WindowEffect::Mica],
            state: None,
            radius: None,
            color: None,
        })
    } else {
        builder
    };

    builder.build().map_err(|error| error.to_string())?;
    Ok(())
}

/// Quit the whole application, including auxiliary windows.
#[tauri::command]
pub async fn app_exit(
    app: tauri::AppHandle,
    supervisor: State<'_, Arc<AgentSupervisor>>,
    agent_terminals: State<'_, Arc<AgentTerminalManager>>,
    ptys: State<'_, Arc<PtyManager>>,
    searches: State<'_, Arc<SearchManager>>,
) -> Result<(), String> {
    let agents = supervisor.kill_all().await;
    let agent_terminals = agent_terminals.kill_all().unwrap_or_default();
    let ptys = ptys.close_all().unwrap_or_default();
    let searches = searches.cancel_all().unwrap_or_default();
    tracing::info!(
        target: "shutdown",
        agents,
        agent_terminals,
        ptys,
        searches,
        "child resources stopped before application exit"
    );
    app.exit(0);
    Ok(())
}

/// Focus the main IDE window from the Agents window.
#[tauri::command]
pub fn window_focus_main(app: tauri::AppHandle) -> Result<(), String> {
    let main = open_welcome_window_impl(&app)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_project_argument() {
        let cwd = std::env::current_dir().expect("current dir");
        let args = vec!["glyphra".to_string(), ".".to_string()];
        let request = launch_request_from_args(&args, &cwd.to_string_lossy()).expect("request");
        assert_eq!(
            request.project_path,
            cwd.canonicalize().unwrap().to_string_lossy()
        );
        assert_eq!(request.file_path, None);
    }

    #[test]
    fn launch_state_retains_the_latest_request_until_main_is_ready() {
        let state = LaunchState::new(None);
        assert!(!state.is_main_ready());
        state.replace_pending(LaunchRequest {
            project_path: "/projects/first".into(),
            file_path: None,
        });
        state.replace_pending(LaunchRequest {
            project_path: "/projects/second".into(),
            file_path: Some("/projects/second/main.rs".into()),
        });
        state.mark_main_ready();

        assert!(state.is_main_ready());
        assert_eq!(
            state.take_pending(),
            Some(LaunchRequest {
                project_path: "/projects/second".into(),
                file_path: Some("/projects/second/main.rs".into()),
            })
        );
    }

    #[test]
    fn resolves_workspace_descriptor() {
        let root = std::env::temp_dir().join(format!("glyphra-launch-{}", std::process::id()));
        let project = root.join("project");
        fs::create_dir_all(&project).expect("create project");
        let descriptor = root.join("demo.glyphra-workspace");
        fs::write(&descriptor, r#"{"folders":[{"path":"project"}]}"#).expect("write descriptor");

        let args = vec![
            "glyphra".to_string(),
            descriptor.to_string_lossy().into_owned(),
        ];
        let request = launch_request_from_args(&args, ".").expect("request");
        assert_eq!(
            request.project_path,
            project.canonicalize().unwrap().to_string_lossy()
        );
        assert_eq!(request.file_path, None);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolves_direct_text_file_argument() {
        let root = std::env::temp_dir().join(format!("glyphra-launch-file-{}", std::process::id()));
        fs::create_dir_all(&root).expect("create project");
        let file = root.join("notes.txt");
        fs::write(&file, "hello from Explorer").expect("write text file");

        let args = vec!["glyphra".to_string(), file.to_string_lossy().into_owned()];
        let request = launch_request_from_args(&args, ".").expect("request");
        assert_eq!(
            request.project_path,
            root.canonicalize().unwrap().to_string_lossy()
        );
        assert_eq!(
            request.file_path.as_deref(),
            Some(file.canonicalize().unwrap().to_string_lossy().as_ref())
        );

        let _ = fs::remove_dir_all(root);
    }
}
