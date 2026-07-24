mod agent;
mod agent_terminal;
mod gitx;
mod ipc;
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

pub fn run() {
    if std::env::args().any(|arg| arg == "--smoke") {
        perf::print_smoke_and_exit();
        return;
    }

    perf::init_tracing();
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
        .manage(perf::Launch(launch))
        .manage(ipc::app::LaunchState::new(initial_launch))
        .manage(state::AppState::default())
        .manage(Arc::new(AgentSupervisor::default()))
        .manage(Arc::new(CheckpointEngine::default()))
        .manage(Arc::new(SearchManager::default()))
        .manage(Arc::new(PtyManager::default()))
        .manage(Arc::new(AgentTerminalManager::default()))
        .invoke_handler(tauri::generate_handler![
            ipc::app::app_ready,
            ipc::app::app_take_launch_request,
            ipc::app::perf_mark,
            ipc::app::window_open_agent,
            ipc::app::window_focus_main,
            ipc::app::app_exit,
            ipc::project::project_open,
            ipc::project::project_recent,
            ipc::project::fs_list,
            ipc::project::fs_read,
            ipc::project::fs_write,
            ipc::project::fs_watch_start,
            ipc::project::fs_watch_stop,
            ipc::settings::settings_get,
            ipc::settings::settings_set,
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
            ipc::git::git_status,
            ipc::git::git_exec_readonly,
            ipc::git::git_diff_file,
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
            ipc::sessions::session_delete
        ])
        .setup(move |_app| {
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
