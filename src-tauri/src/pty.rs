//! PTY sessions via portable-pty, with 8ms stdout coalescing.

use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/PtyEvent.ts")]
pub struct PtyEvent {
    pub pty_id: u32,
    pub kind: String,
    pub data: String,
}

struct LivePty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

#[derive(Default)]
pub struct PtyManager {
    next_id: AtomicU32,
    sessions: Mutex<HashMap<u32, LivePty>>,
}

impl PtyManager {
    pub fn open(
        self: &Arc<Self>,
        cwd: String,
        cols: u16,
        rows: u16,
        channel: Channel<PtyEvent>,
    ) -> Result<u32, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|err| format!("openpty: {err}"))?;

        let mut cmd = CommandBuilder::new(default_shell());
        cmd.cwd(cwd);

        let _child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|err| format!("spawn shell: {err}"))?;
        // Keep slave dropped so the child owns the tty; child is waitable via drop.
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|err| format!("clone reader: {err}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|err| format!("take writer: {err}"))?;

        let pty_id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        self.sessions
            .lock()
            .map_err(|_| "pty lock poisoned")?
            .insert(
                pty_id,
                LivePty {
                    master: pair.master,
                    writer,
                },
            );

        let manager = Arc::clone(self);
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut pending = Vec::new();
            let mut last_flush = Instant::now();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                        if last_flush.elapsed() >= Duration::from_millis(8) || pending.len() > 4096
                        {
                            flush_bytes(pty_id, &channel, &mut pending);
                            last_flush = Instant::now();
                        }
                    }
                    Err(_) => break,
                }
            }
            if !pending.is_empty() {
                flush_bytes(pty_id, &channel, &mut pending);
            }
            let _ = channel.send(PtyEvent {
                pty_id,
                kind: "exit".into(),
                data: "0".into(),
            });
            if let Ok(mut sessions) = manager.sessions.lock() {
                sessions.remove(&pty_id);
            }
        });

        Ok(pty_id)
    }

    pub fn write(&self, pty_id: u32, data: String) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|_| "pty lock poisoned")?;
        let session = sessions
            .get_mut(&pty_id)
            .ok_or_else(|| format!("unknown pty {pty_id}"))?;
        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|err| format!("pty write: {err}"))?;
        session
            .writer
            .flush()
            .map_err(|err| format!("pty flush: {err}"))?;
        Ok(())
    }

    pub fn resize(&self, pty_id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|_| "pty lock poisoned")?;
        let session = sessions
            .get(&pty_id)
            .ok_or_else(|| format!("unknown pty {pty_id}"))?;
        session
            .master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|err| format!("pty resize: {err}"))?;
        Ok(())
    }

    pub fn close(&self, pty_id: u32) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|_| "pty lock poisoned")?;
        sessions.remove(&pty_id);
        Ok(())
    }
}

fn flush_bytes(pty_id: u32, channel: &Channel<PtyEvent>, pending: &mut Vec<u8>) {
    if pending.is_empty() {
        return;
    }
    let data = String::from_utf8_lossy(pending).to_string();
    pending.clear();
    let _ = channel.send(PtyEvent {
        pty_id,
        kind: "data".into(),
        data,
    });
}

fn default_shell() -> String {
    if cfg!(windows) {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
    }
}
