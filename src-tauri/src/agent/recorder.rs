//! Bidirectional ACP wire recorder.
//!
//! Each line:
//! ```json
//! {"t":12,"dir":"in"|"out"|"err","line":"<raw NDJSON without trailing newline>"}
//! ```
//! `t` is milliseconds since recorder open. Enable with `GLYPHRA_RECORD=1`
//! (writes under `{app_data}/agent-tapes/`).

use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::Instant,
};

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Copy)]
pub enum Direction {
    In,
    Out,
    Err,
}

impl Direction {
    fn as_str(self) -> &'static str {
        match self {
            Self::In => "in",
            Self::Out => "out",
            Self::Err => "err",
        }
    }
}

#[derive(Serialize)]
struct RecordLine<'a> {
    t: u64,
    dir: &'a str,
    line: &'a str,
}

pub struct SessionRecorder {
    start: Instant,
    file: Mutex<File>,
    pub path: PathBuf,
}

impl SessionRecorder {
    pub fn create(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create tape dir: {err}"))?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&path)
            .map_err(|err| format!("failed to open tape {}: {err}", path.display()))?;
        let header = "{\"t\":0,\"dir\":\"meta\",\"line\":\"glyphra-agent-tape v1\"}\n";
        file.write_all(header.as_bytes())
            .map_err(|err| format!("failed to write tape header: {err}"))?;
        file.flush()
            .map_err(|err| format!("failed to flush tape header: {err}"))?;
        Ok(Self {
            start: Instant::now(),
            file: Mutex::new(file),
            path,
        })
    }

    /// When `GLYPHRA_RECORD=1`, open a tape under app data.
    pub fn maybe_from_env(app: &AppHandle, session_id: u32, backend: &str) -> Option<Self> {
        let enabled = std::env::var("GLYPHRA_RECORD")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        if !enabled {
            return None;
        }
        let dir = app.path().app_data_dir().ok()?.join("agent-tapes");
        let safe_backend: String = backend
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let path = dir.join(format!("{session_id}-{safe_backend}.jsonl"));
        match Self::create(path) {
            Ok(recorder) => {
                tracing::info!(
                    target: "agent",
                    path = %recorder.path.display(),
                    "recording agent wire tape"
                );
                Some(recorder)
            }
            Err(err) => {
                tracing::warn!(target: "agent", error = %err, "failed to start recorder");
                None
            }
        }
    }

    pub fn record(&self, direction: Direction, line: &str) {
        let payload = RecordLine {
            t: self.start.elapsed().as_millis() as u64,
            dir: direction.as_str(),
            line,
        };
        let Ok(mut encoded) = serde_json::to_string(&payload) else {
            return;
        };
        encoded.push('\n');
        if let Ok(mut file) = self.file.lock() {
            let _ = file.write_all(encoded.as_bytes());
            let _ = file.flush();
        }
    }
}

/// Parse a wire tape into (t_ms, dir, line) triples — used by Rust unit tests.
#[cfg(test)]
fn parse_wire_tape(text: &str) -> Result<Vec<(u64, String, String)>, String> {
    let mut rows = Vec::new();
    for (idx, raw) in text.lines().enumerate() {
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        let value: serde_json::Value =
            serde_json::from_str(raw).map_err(|err| format!("tape line {}: {err}", idx + 1))?;
        let t = value
            .get("t")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| format!("tape line {}: missing t", idx + 1))?;
        let dir = value
            .get("dir")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let line = value
            .get("line")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if dir == "meta" {
            continue;
        }
        rows.push((t, dir, line));
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_and_parses_roundtrip() {
        let dir = std::env::temp_dir().join(format!(
            "glyphra-tape-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = dir.join("demo.jsonl");
        let recorder = SessionRecorder::create(path.clone()).unwrap();
        recorder.record(
            Direction::In,
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize"}"#,
        );
        recorder.record(Direction::Out, r#"{"jsonrpc":"2.0","id":1,"result":{}}"#);
        drop(recorder);

        let text = fs::read_to_string(&path).unwrap();
        let rows = parse_wire_tape(&text).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].1, "in");
        assert_eq!(rows[1].1, "out");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn parse_skips_meta() {
        let text = r#"
{"t":0,"dir":"meta","line":"glyphra-agent-tape v1"}
{"t":1,"dir":"out","line":"{\"a\":1}"}
"#;
        let rows = parse_wire_tape(text).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].2, r#"{"a":1}"#);
    }

    #[test]
    fn parses_committed_wire_sample() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../fixtures/tapes/wire-framing-sample.jsonl");
        let text = fs::read_to_string(&path).expect("wire sample present");
        let rows = parse_wire_tape(&text).unwrap();
        assert!(rows.iter().any(|row| row.1 == "in"));
        assert!(rows.iter().any(|row| row.1 == "out"));
        let out_updates = rows
            .iter()
            .filter(|row| row.1 == "out")
            .filter(|row| row.2.contains("session/update"))
            .count();
        assert_eq!(out_updates, 1);
    }
}
