mod ipc;
mod perf;
mod state;

pub fn run() {
    if std::env::args().any(|arg| arg == "--smoke") {
        perf::print_smoke_and_exit();
        return;
    }

    perf::init_tracing();
    let launch = std::time::Instant::now();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(perf::Launch(launch))
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            ipc::app::app_ready,
            ipc::app::perf_mark,
            ipc::project::project_open,
            ipc::project::project_recent,
            ipc::project::fs_list,
            ipc::project::fs_read,
            ipc::project::fs_write,
            ipc::project::fs_watch_start,
            ipc::project::fs_watch_stop,
            ipc::settings::settings_get,
            ipc::settings::settings_set
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
