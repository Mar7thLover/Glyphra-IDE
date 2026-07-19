use std::time::Instant;

use serde_json::json;
use sysinfo::{get_current_pid, ProcessesToUpdate, System};
use tracing_subscriber::EnvFilter;

/// Process launch timestamp, managed as Tauri state so IPC commands can
/// report elapsed-since-launch for startup phases.
pub struct Launch(pub Instant);

pub fn init_tracing() {
    let filter = EnvFilter::try_from_env("GLYPHRA_LOG").unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .init();
}

/// Lightweight binary smoke (no WebView). Reports process RSS and the time
/// spent reaching this handler — a floor for cold-start, not full TTI.
pub fn print_smoke_and_exit() {
    let started = Instant::now();
    let rss_mb = current_rss_mb();
    let tti_ms = started.elapsed().as_millis() as u64;

    let payload = json!({
        "ok": true,
        "mode": "smoke",
        "ttiMs": tti_ms,
        "rssMb": rss_mb,
        "note": "binary smoke (no WebView); full interactive TTI is measured via perf_mark('tti')"
    });
    println!("{}", payload);
}

fn current_rss_mb() -> u64 {
    let Ok(pid) = get_current_pid() else {
        return 0;
    };
    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    sys.process(pid)
        .map(|process| process.memory() / (1024 * 1024))
        .unwrap_or(0)
}
