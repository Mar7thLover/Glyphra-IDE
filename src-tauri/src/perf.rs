use std::time::Instant;

use serde_json::json;
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

pub fn print_smoke_and_exit() {
    let payload = json!({
        "ok": true,
        "mode": "smoke",
        "ttiMs": 0,
        "rssMb": 0,
        "note": "M0 stub: full WebView startup/RSS smoke lands after CI harness wiring"
    });
    println!("{}", payload);
}
