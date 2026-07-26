//! PTY sessions via portable-pty, with 8ms stdout coalescing.

use std::{
    collections::HashMap,
    ffi::OsString,
    io::{Read, Write},
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::path::PathBuf;

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
    sessions: Mutex<HashMap<(String, u32), LivePty>>,
}

impl PtyManager {
    pub fn live_count(&self) -> Result<usize, String> {
        Ok(self.sessions.lock().map_err(|_| "pty lock poisoned")?.len())
    }

    pub fn open(
        self: &Arc<Self>,
        window_label: &str,
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

        let shell = default_shell();
        let mut cmd = CommandBuilder::new(&shell.program);
        cmd.args(&shell.args);
        cmd.cwd(shell_cwd(cwd));
        // Give interactive programs a consistent capability hint on every host.
        // ConPTY understands VT sequences and both PowerShell editions respect TERM.
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

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
        let session_key = (window_label.to_owned(), pty_id);
        self.sessions
            .lock()
            .map_err(|_| "pty lock poisoned")?
            .insert(
                session_key.clone(),
                LivePty {
                    master: pair.master,
                    writer,
                },
            );

        let manager = Arc::clone(self);
        let exit_key = session_key;
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
                sessions.remove(&exit_key);
            }
        });

        Ok(pty_id)
    }

    pub fn write(&self, window_label: &str, pty_id: u32, data: String) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|_| "pty lock poisoned")?;
        let session = sessions
            .get_mut(&(window_label.to_owned(), pty_id))
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

    pub fn resize(
        &self,
        window_label: &str,
        pty_id: u32,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let sessions = self.sessions.lock().map_err(|_| "pty lock poisoned")?;
        let session = sessions
            .get(&(window_label.to_owned(), pty_id))
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

    pub fn close(&self, window_label: &str, pty_id: u32) -> Result<(), String> {
        let mut sessions = self.sessions.lock().map_err(|_| "pty lock poisoned")?;
        sessions.remove(&(window_label.to_owned(), pty_id));
        Ok(())
    }

    pub fn close_window(&self, window_label: &str) -> Result<usize, String> {
        let mut sessions = self.sessions.lock().map_err(|_| "pty lock poisoned")?;
        let before = sessions.len();
        sessions.retain(|(label, _), _| label != window_label);
        Ok(before - sessions.len())
    }

    /// Dropping every PTY master closes ConPTY/Unix PTYs and terminates shells.
    pub fn close_all(&self) -> Result<usize, String> {
        let mut sessions = self.sessions.lock().map_err(|_| "pty lock poisoned")?;
        let count = sessions.len();
        sessions.clear();
        Ok(count)
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

#[derive(Debug, PartialEq)]
struct ShellCommand {
    program: OsString,
    args: Vec<OsString>,
}

fn shell_cwd(cwd: String) -> String {
    #[cfg(windows)]
    {
        // std::fs::canonicalize returns verbatim paths on Windows. They are
        // useful internally, but PowerShell exposes them as provider-qualified
        // locations such as Microsoft.PowerShell.Core\FileSystem::\\?\D:\...
        if let Some(path) = cwd.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{path}");
        }

        if let Some(path) = cwd.strip_prefix(r"\\?\") {
            let bytes = path.as_bytes();
            let is_drive_path = bytes.len() >= 3
                && bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && matches!(bytes[2], b'\\' | b'/');
            if is_drive_path {
                return path.to_owned();
            }
        }
    }

    cwd
}

#[cfg(windows)]
fn default_shell() -> ShellCommand {
    // Prefer modern, cross-platform PowerShell when it is installed. Windows
    // PowerShell remains present on supported Windows versions and is the
    // deterministic fallback; COMSPEC intentionally is not used here.
    let program = find_on_path("pwsh.exe")
        .or_else(|| {
            std::env::var_os("ProgramFiles")
                .map(PathBuf::from)
                .map(|path| path.join("PowerShell").join("7").join("pwsh.exe"))
                .filter(|path| path.is_file())
        })
        .or_else(|| {
            std::env::var_os("SystemRoot")
                .map(PathBuf::from)
                .map(|path| {
                    path.join("System32")
                        .join("WindowsPowerShell")
                        .join("v1.0")
                        .join("powershell.exe")
                })
                .filter(|path| path.is_file())
        })
        .map(OsString::from)
        .unwrap_or_else(|| OsString::from("powershell.exe"));

    ShellCommand {
        program,
        args: vec![OsString::from("-NoLogo")],
    }
}

#[cfg(windows)]
fn find_on_path(executable: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|directory| directory.join(executable))
        .find(|candidate| candidate.is_file())
}

#[cfg(not(windows))]
fn default_shell() -> ShellCommand {
    let configured = std::env::var_os("SHELL").filter(|shell| !shell.is_empty());

    #[cfg(target_os = "macos")]
    let fallback = "/bin/zsh";
    #[cfg(not(target_os = "macos"))]
    let fallback = "/bin/sh";

    ShellCommand {
        program: configured.unwrap_or_else(|| OsString::from(fallback)),
        args: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn windows_terminal_uses_powershell_without_a_logo() {
        let shell = default_shell();
        let executable = PathBuf::from(&shell.program)
            .file_name()
            .expect("PowerShell executable should have a file name")
            .to_string_lossy()
            .to_ascii_lowercase();

        assert!(matches!(executable.as_str(), "pwsh.exe" | "powershell.exe"));
        assert_eq!(shell.args, vec![OsString::from("-NoLogo")]);
    }

    #[cfg(windows)]
    #[test]
    fn windows_shell_cwd_removes_verbatim_path_prefixes() {
        assert_eq!(
            shell_cwd(r"\\?\D:\Projects\Glyphra-IDE".into()),
            r"D:\Projects\Glyphra-IDE"
        );
        assert_eq!(
            shell_cwd(r"\\?\UNC\server\share\project".into()),
            r"\\server\share\project"
        );
        assert_eq!(
            shell_cwd(r"D:\Projects\Glyphra-IDE".into()),
            r"D:\Projects\Glyphra-IDE"
        );
    }

    #[test]
    fn close_all_is_idempotent_when_no_ptys_are_open() {
        let manager = PtyManager::default();
        assert_eq!(manager.close_all().unwrap(), 0);
        assert_eq!(manager.close_all().unwrap(), 0);
    }

    #[cfg(not(windows))]
    #[test]
    fn unix_terminal_uses_an_interactive_user_shell() {
        let shell = default_shell();

        assert!(!shell.program.is_empty());
        assert!(shell.args.is_empty());
    }
}
