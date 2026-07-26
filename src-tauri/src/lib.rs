mod agent;
mod agent_terminal;
mod gitx;
mod ipc;
mod mcp;
mod paths;
mod perf;
mod process_ext;
mod providers;
mod pty;
mod runtime_resources;
mod search;
mod state;
mod vault;

use std::sync::Arc;

use agent::supervisor::AgentSupervisor;
use agent_terminal::AgentTerminalManager;
use gitx::checkpoints::CheckpointEngine;
use pty::PtyManager;
use search::SearchManager;
use tauri::Manager;

pub fn run() {
    if std::env::args().any(|arg| arg == "--smoke") {
        perf::print_smoke_and_exit();
        return;
    }

    let launch = std::time::Instant::now();
    let args = std::env::args().collect::<Vec<_>>();
    let cwd = std::env::current_dir().unwrap_or_default();
    let initial_launch = ipc::app::launch_request_from_args(&args, &cwd.to_string_lossy());

    tauri::Builder::default()
        // Must be the first plugin so a secondary process exits before later
        // plugins can create competing process-level state.
        .plugin(tauri_plugin_single_instance::init(
            ipc::app::handle_second_instance,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(perf::Launch(launch))
        .manage(ipc::app::LaunchState::new(initial_launch))
        .manage(state::AppState::default())
        .manage(Arc::new(AgentSupervisor::default()))
        .manage(Arc::new(CheckpointEngine::default()))
        .manage(Arc::new(SearchManager::default()))
        .manage(Arc::new(PtyManager::default()))
        .manage(Arc::new(AgentTerminalManager::default()))
        .on_window_event(|window, event| {
            if !matches!(event, tauri::WindowEvent::Destroyed) {
                return;
            }
            let window_label = window.label().to_owned();
            let supervisor = Arc::clone(window.state::<Arc<AgentSupervisor>>().inner());
            let terminals = Arc::clone(window.state::<Arc<AgentTerminalManager>>().inner());
            let ptys = Arc::clone(window.state::<Arc<PtyManager>>().inner());
            let searches = Arc::clone(window.state::<Arc<SearchManager>>().inner());
            tauri::async_runtime::spawn(async move {
                let agents = supervisor.kill_window(&window_label).await;
                let terminals = terminals.kill_window(&window_label).unwrap_or_default();
                let ptys = ptys.close_window(&window_label).unwrap_or_default();
                let searches = searches.cancel_window(&window_label).unwrap_or_default();
                tracing::info!(
                    target: "shutdown",
                    %window_label,
                    agents,
                    terminals,
                    ptys,
                    searches,
                    "window resources stopped"
                );
            });
        })
        .invoke_handler(tauri::generate_handler![
            ipc::app::app_ready,
            ipc::app::app_take_launch_request,
            ipc::app::app_prepare_restart,
            ipc::app::perf_mark,
            ipc::app::window_open_agent,
            ipc::app::window_open_project,
            ipc::app::window_focus_main,
            ipc::app::app_exit,
            ipc::diagnostics::diagnostics_info,
            ipc::diagnostics::diagnostics_create_bundle,
            ipc::diagnostics::diagnostics_reveal_logs,
            ipc::diagnostics::diagnostics_resource_counts,
            ipc::diagnostics::diagnostics_fault_panic,
            ipc::editorconfig::editor_config_resolve,
            ipc::project::project_open,
            ipc::project::project_symbols,
            ipc::project::project_recent,
            ipc::project::fs_list,
            ipc::project::fs_media_preview,
            ipc::project::fs_read,
            ipc::project::fs_read_with_encoding,
            ipc::project::fs_write,
            ipc::project::fs_watch_start,
            ipc::project::fs_watch_stop,
            ipc::recovery::editor_recovery_save,
            ipc::recovery::editor_recovery_load,
            ipc::recovery::editor_recovery_clear,
            ipc::settings::settings_get,
            ipc::settings::settings_set,
            ipc::theme::theme_import_vscode,
            ipc::agent::agent_detect,
            ipc::agent::agent_catalog,
            ipc::agent::runtime_detect,
            ipc::agent::agent_spawn,
            ipc::agent::agent_write,
            ipc::agent::agent_kill,
            ipc::providers::providers_list,
            ipc::providers::providers_upsert,
            ipc::providers::providers_remove,
            ipc::providers::vault_probe,
            ipc::providers::vault_clear,
            ipc::providers::provider_test,
            ipc::providers::provider_usage,
            ipc::mcp::mcp_servers_list,
            ipc::mcp::mcp_servers_upsert,
            ipc::mcp::mcp_servers_remove,
            ipc::git::git_status,
            ipc::git::git_exec_readonly,
            ipc::git::git_diff_file,
            ipc::git::git_commit,
            ipc::ckpt::ckpt_begin_turn,
            ipc::ckpt::ckpt_preimage,
            ipc::ckpt::ckpt_commit_turn,
            ipc::ckpt::ckpt_list_turns,
            ipc::ckpt::ckpt_file_contents,
            ipc::ckpt::ckpt_hunks,
            ipc::ckpt::ckpt_restore_turn,
            ipc::ckpt::ckpt_restore_file,
            ipc::ckpt::ckpt_write_file,
            ipc::search::search_start,
            ipc::search::search_cancel,
            ipc::pty::pty_open,
            ipc::pty::pty_write,
            ipc::pty::pty_resize,
            ipc::pty::pty_close,
            ipc::agent_term::agent_term_create,
            ipc::agent_term::agent_term_output,
            ipc::agent_term::agent_term_wait,
            ipc::agent_term::agent_term_kill,
            ipc::agent_term::agent_term_release,
            ipc::sessions::session_list,
            ipc::sessions::session_save,
            ipc::sessions::session_load,
            ipc::sessions::session_rename,
            ipc::sessions::session_delete
        ])
        .setup(move |app| {
            let log_dir = app
                .path()
                .app_log_dir()
                .unwrap_or_else(|_| perf::fallback_log_dir());
            let log_guard = perf::init_tracing(log_dir.clone());
            app.manage(log_guard);
            perf::install_panic_hook(log_dir);
            tracing::info!(
                target: "perf",
                phase = "app_setup",
                elapsed_ms = launch.elapsed().as_millis() as u64
            );
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Glyphra");
}
