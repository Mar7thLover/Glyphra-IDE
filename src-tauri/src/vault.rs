use std::{fs, path::PathBuf, sync::Mutex};

use keyring::Entry;
use tauri::{AppHandle, Manager};

/// Serializes all keyring access — the Windows credential backend is not
/// safe for concurrent callers.
static VAULT_LOCK: Mutex<()> = Mutex::new(());

const SERVICE: &str = "glyphra";

fn validate_id(id: &str) -> Result<(), String> {
    if id.trim().is_empty() || id.contains('/') || id.contains('\\') {
        return Err("invalid vault id".into());
    }
    Ok(())
}

fn entry_for(id: &str) -> Result<Entry, String> {
    validate_id(id)?;
    Entry::new(SERVICE, &format!("provider/{id}")).map_err(|err| err.to_string())
}

fn legacy_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    validate_id(id)?;
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("config dir: {err}"))?;
    Ok(dir.join("vault").join(format!("{id}.secret")))
}

pub fn set_secret(app: &AppHandle, id: &str, secret: &str) -> Result<(), String> {
    let _guard = VAULT_LOCK
        .lock()
        .map_err(|_| "vault lock poisoned".to_string())?;
    entry_for(id)?.set_password(secret).map_err(|err| {
        format!("OS keyring unavailable ({err}); refusing to store the secret in plaintext")
    })?;

    // Keyring is authoritative now — remove any file created by an older build.
    let legacy = legacy_path(app, id)?;
    if legacy.exists() {
        fs::remove_file(&legacy)
            .map_err(|err| format!("remove legacy plaintext credential: {err}"))?;
        tracing::info!(path = %legacy.display(), "removed legacy plaintext credential");
    }
    Ok(())
}

pub fn probe(app: &AppHandle, id: &str) -> Result<bool, String> {
    Ok(read_secret(app, id)?.is_some())
}

pub fn clear(app: &AppHandle, id: &str) -> Result<(), String> {
    let _guard = VAULT_LOCK
        .lock()
        .map_err(|_| "vault lock poisoned".to_string())?;
    let entry = entry_for(id)?;
    let _ = entry.delete_credential();
    let legacy = legacy_path(app, id)?;
    if legacy.exists() {
        fs::remove_file(legacy)
            .map_err(|err| format!("remove legacy plaintext credential: {err}"))?;
    }
    Ok(())
}

/// Read secret for spawn-time env injection only. Never exposed over IPC.
pub fn read_secret(app: &AppHandle, id: &str) -> Result<Option<String>, String> {
    let _guard = VAULT_LOCK
        .lock()
        .map_err(|_| "vault lock poisoned".to_string())?;
    let entry = entry_for(id)?;
    if let Ok(secret) = entry.get_password() {
        return Ok(Some(secret));
    }

    let legacy = legacy_path(app, id)?;
    if !legacy.exists() {
        return Ok(None);
    }

    // One-time migration for users of older builds. Never consume a plaintext
    // credential unless it can first be moved into the OS keyring.
    let secret = fs::read_to_string(&legacy)
        .map_err(|err| format!("read legacy plaintext credential: {err}"))?;
    entry.set_password(&secret).map_err(|err| {
        format!(
            "OS keyring unavailable ({err}); legacy plaintext credential was not used or modified"
        )
    })?;
    fs::remove_file(&legacy)
        .map_err(|err| format!("remove migrated plaintext credential: {err}"))?;
    tracing::info!(path = %legacy.display(), "migrated legacy plaintext credential to OS keyring");
    Ok(Some(secret))
}

#[cfg(test)]
mod tests {
    use super::validate_id;

    #[test]
    fn rejects_empty_or_path_like_vault_ids() {
        for id in ["", "  ", "../token", r"..\token", "provider/token"] {
            assert!(validate_id(id).is_err(), "{id:?} should be rejected");
        }
        assert!(validate_id("provider-123").is_ok());
    }
}
