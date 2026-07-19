use std::{fs, path::PathBuf, sync::Mutex};

use keyring::Entry;
use tauri::{AppHandle, Manager};

/// Serializes all keyring access — the Windows credential backend is not
/// safe for concurrent callers.
static VAULT_LOCK: Mutex<()> = Mutex::new(());

const SERVICE: &str = "glyphra";

fn entry_for(id: &str) -> Result<Entry, String> {
    if id.trim().is_empty() || id.contains('/') || id.contains('\\') {
        return Err("invalid vault id".into());
    }
    Entry::new(SERVICE, &format!("provider/{id}")).map_err(|err| err.to_string())
}

fn fallback_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("config dir: {err}"))?
        .join("vault");
    fs::create_dir_all(&dir).map_err(|err| format!("create vault dir: {err}"))?;
    Ok(dir.join(format!("{id}.secret")))
}

pub fn set_secret(app: &AppHandle, id: &str, secret: &str) -> Result<(), String> {
    let _guard = VAULT_LOCK
        .lock()
        .map_err(|_| "vault lock poisoned".to_string())?;
    match entry_for(id)?.set_password(secret) {
        Ok(()) => Ok(()),
        Err(err) => {
            // Headless / CI environments often lack a keyring backend.
            tracing::warn!(error = %err, "keyring set failed; using file fallback");
            let path = fallback_path(app, id)?;
            fs::write(path, secret).map_err(|e| format!("vault fallback write: {e}"))
        }
    }
}

pub fn probe(app: &AppHandle, id: &str) -> Result<bool, String> {
    let _guard = VAULT_LOCK
        .lock()
        .map_err(|_| "vault lock poisoned".to_string())?;
    if let Ok(entry) = entry_for(id) {
        if entry.get_password().is_ok() {
            return Ok(true);
        }
    }
    Ok(fallback_path(app, id)?.exists())
}

pub fn clear(app: &AppHandle, id: &str) -> Result<(), String> {
    let _guard = VAULT_LOCK
        .lock()
        .map_err(|_| "vault lock poisoned".to_string())?;
    if let Ok(entry) = entry_for(id) {
        let _ = entry.delete_credential();
    }
    let path = fallback_path(app, id)?;
    if path.exists() {
        fs::remove_file(path).map_err(|err| format!("vault fallback remove: {err}"))?;
    }
    Ok(())
}

/// Read secret for spawn-time env injection only. Never exposed over IPC.
pub fn read_secret(app: &AppHandle, id: &str) -> Result<Option<String>, String> {
    let _guard = VAULT_LOCK
        .lock()
        .map_err(|_| "vault lock poisoned".to_string())?;
    if let Ok(entry) = entry_for(id) {
        if let Ok(secret) = entry.get_password() {
            return Ok(Some(secret));
        }
    }
    let path = fallback_path(app, id)?;
    if !path.exists() {
        return Ok(None);
    }
    let secret = fs::read_to_string(path).map_err(|err| format!("vault fallback read: {err}"))?;
    Ok(Some(secret))
}
