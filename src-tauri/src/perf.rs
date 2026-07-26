use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde_json::json;
use sysinfo::{get_current_pid, ProcessesToUpdate, System};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::fmt::writer::MakeWriterExt;
use tracing_subscriber::EnvFilter;

/// Process launch timestamp, managed as Tauri state so IPC commands can
/// report elapsed-since-launch for startup phases.
pub struct Launch(pub Instant);

const LOG_RETENTION: Duration = Duration::from_secs(14 * 24 * 60 * 60);

/// Keeps the non-blocking writer alive for the process lifetime as Tauri state.
pub struct LogGuard {
    _worker: Option<WorkerGuard>,
}

pub fn fallback_log_dir() -> PathBuf {
    std::env::temp_dir().join("dev.glyphra.ide").join("logs")
}

/// Initialize tracing to stdout **and** a daily-rolling file, so crashes in the
/// packaged `windows_subsystem = "windows"` build (where stdout is detached)
/// still leave a trace. The returned guard must be kept alive for the process
/// lifetime or buffered file logs are dropped.
#[must_use]
pub fn init_tracing(dir: PathBuf) -> LogGuard {
    let filter = EnvFilter::try_from_env("GLYPHRA_LOG").unwrap_or_else(|_| EnvFilter::new("info"));

    match fs::create_dir_all(&dir) {
        Ok(()) => {
            prune_old_logs(&dir);
            let appender = tracing_appender::rolling::daily(&dir, "glyphra.log");
            let (file_writer, guard) = tracing_appender::non_blocking(appender);
            tracing_subscriber::fmt()
                .with_env_filter(filter)
                .with_target(true)
                .with_ansi(false)
                .with_writer(std::io::stdout.and(file_writer))
                .init();
            tracing::info!(target: "perf", log_dir = %dir.display(), "file logging active");
            LogGuard {
                _worker: Some(guard),
            }
        }
        Err(err) => {
            tracing_subscriber::fmt()
                .with_env_filter(filter)
                .with_target(true)
                .init();
            tracing::warn!(error = %err, dir = %dir.display(), "log dir unavailable; stdout only");
            LogGuard { _worker: None }
        }
    }
}

/// `panic = "abort"` does not give a background log writer time to flush.
/// Append the panic record synchronously before emitting it through tracing.
pub fn install_panic_hook(log_dir: PathBuf) {
    std::panic::set_hook(Box::new(move |info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_secs())
            .unwrap_or_default();
        let record = format!("unix_time={timestamp}\nfatal panic: {info}\n{backtrace}\n");
        if let Err(err) = append_panic_record(&log_dir, &record) {
            eprintln!("failed to persist panic record: {err}");
        }
        tracing::error!(target: "panic", "{record}");
    }));
}

fn append_panic_record(log_dir: &Path, record: &str) -> std::io::Result<()> {
    fs::create_dir_all(log_dir)?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("panic.log"))?;
    writeln!(file, "{record}")?;
    file.flush()
}

fn prune_old_logs(log_dir: &Path) {
    let Ok(entries) = fs::read_dir(log_dir) else {
        return;
    };
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !name.starts_with("glyphra.log.") {
            continue;
        }
        let Ok(modified) = entry.metadata().and_then(|metadata| metadata.modified()) else {
            continue;
        };
        if now
            .duration_since(modified)
            .is_ok_and(|age| age > LOG_RETENTION)
        {
            let _ = fs::remove_file(entry.path());
        }
    }
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

#[cfg(test)]
mod tests {
    use super::append_panic_record;

    #[test]
    fn panic_record_is_written_synchronously() {
        let dir = std::env::temp_dir().join(format!("glyphra-panic-test-{}", uuid::Uuid::new_v4()));
        append_panic_record(&dir, "fatal panic: test").expect("write panic record");

        let content = std::fs::read_to_string(dir.join("panic.log")).expect("read panic record");
        assert!(content.contains("fatal panic: test"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
