use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use ts_rs::TS;
use uuid::Uuid;

const MAX_SERVERS: usize = 64;
const MAX_ARGS: usize = 128;
const MAX_NAME_CHARS: usize = 128;
const MAX_VALUE_CHARS: usize = 8 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/McpTransport.ts")]
pub enum McpTransport {
    Stdio,
    Http,
    Sse,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/McpServerRecord.ts")]
pub struct McpServerRecord {
    pub id: String,
    pub name: String,
    pub transport: McpTransport,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub url: Option<String>,
    pub enabled: bool,
    #[ts(type = "number")]
    pub created_at: u64,
    #[ts(type = "number")]
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/McpServerUpsert.ts")]
pub struct McpServerUpsert {
    pub id: Option<String>,
    pub name: String,
    pub transport: McpTransport,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    pub url: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpFile {
    #[serde(default = "file_version")]
    version: u32,
    #[serde(default)]
    servers: Vec<McpServerRecord>,
}

fn file_version() -> u32 {
    1
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn mcp_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("config dir: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("create config dir: {err}"))?;
    Ok(dir.join("mcp-servers.json"))
}

fn load_path(path: &std::path::Path) -> Result<McpFile, String> {
    if !path.exists() {
        return Ok(McpFile {
            version: file_version(),
            servers: Vec::new(),
        });
    }
    let data = fs::read_to_string(path).map_err(|err| format!("read MCP settings: {err}"))?;
    serde_json::from_str(&data).map_err(|err| format!("parse MCP settings: {err}"))
}

fn save_path(path: &std::path::Path, file: &McpFile) -> Result<(), String> {
    let data = serde_json::to_string_pretty(file)
        .map_err(|err| format!("serialize MCP settings: {err}"))?;
    fs::write(path, data).map_err(|err| format!("write MCP settings: {err}"))
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-' || value == '_')
    {
        return Err("invalid MCP server id".into());
    }
    Ok(())
}

fn validate_input(input: &mut McpServerUpsert) -> Result<(), String> {
    input.name = input.name.trim().to_string();
    if input.name.is_empty() || input.name.chars().count() > MAX_NAME_CHARS {
        return Err(format!(
            "MCP server name must be 1-{MAX_NAME_CHARS} characters"
        ));
    }
    if input.args.len() > MAX_ARGS
        || input
            .args
            .iter()
            .any(|value| value.contains('\0') || value.chars().count() > MAX_VALUE_CHARS)
    {
        return Err("MCP arguments are too large or contain a NUL byte".into());
    }
    if input.name.contains('\0') {
        return Err("MCP server name contains a NUL byte".into());
    }

    input.command = clean_optional(input.command.take());
    input.url = clean_optional(input.url.take());
    match input.transport {
        McpTransport::Stdio => {
            let command = input
                .command
                .as_deref()
                .ok_or_else(|| "stdio MCP servers require an executable".to_string())?;
            if command.contains('\0') || command.chars().count() > MAX_VALUE_CHARS {
                return Err("MCP executable is too large or contains a NUL byte".into());
            }
            input.url = None;
        }
        McpTransport::Http | McpTransport::Sse => {
            let url = input
                .url
                .as_deref()
                .ok_or_else(|| "remote MCP servers require a URL".to_string())?;
            if url.contains('\0')
                || url.chars().count() > MAX_VALUE_CHARS
                || !(url.starts_with("http://") || url.starts_with("https://"))
            {
                return Err("MCP URL must be an http:// or https:// URL".into());
            }
            input.command = None;
            input.args.clear();
        }
    }
    if let Some(id) = &input.id {
        validate_id(id)?;
    }
    Ok(())
}

pub fn list(app: &AppHandle) -> Result<Vec<McpServerRecord>, String> {
    Ok(load_path(&mcp_path(app)?)?.servers)
}

fn upsert_path(
    path: &std::path::Path,
    mut input: McpServerUpsert,
) -> Result<McpServerRecord, String> {
    validate_input(&mut input)?;
    let mut file = load_path(path)?;
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    validate_id(&id)?;

    if file
        .servers
        .iter()
        .any(|server| server.id != id && server.name.eq_ignore_ascii_case(&input.name))
    {
        return Err(format!(
            "an MCP server named `{}` already exists",
            input.name
        ));
    }
    if file.servers.len() >= MAX_SERVERS && !file.servers.iter().any(|server| server.id == id) {
        return Err(format!(
            "at most {MAX_SERVERS} MCP servers can be configured"
        ));
    }

    let now = now_millis();
    let created_at = file
        .servers
        .iter()
        .find(|server| server.id == id)
        .map(|server| server.created_at)
        .unwrap_or(now);
    let record = McpServerRecord {
        id: id.clone(),
        name: input.name,
        transport: input.transport,
        command: input.command,
        args: input.args,
        url: input.url,
        enabled: input.enabled,
        created_at,
        updated_at: now,
    };
    if let Some(existing) = file.servers.iter_mut().find(|server| server.id == id) {
        *existing = record.clone();
    } else {
        file.servers.push(record.clone());
    }
    file.servers
        .sort_by_key(|server| server.name.to_lowercase());
    save_path(path, &file)?;
    Ok(record)
}

fn remove_path(path: &std::path::Path, id: &str) -> Result<(), String> {
    validate_id(id)?;
    let mut file = load_path(path)?;
    let before = file.servers.len();
    file.servers.retain(|server| server.id != id);
    if file.servers.len() == before {
        return Err(format!("unknown MCP server `{id}`"));
    }
    save_path(path, &file)
}

pub fn upsert(app: &AppHandle, input: McpServerUpsert) -> Result<McpServerRecord, String> {
    upsert_path(&mcp_path(app)?, input)
}

pub fn remove(app: &AppHandle, id: &str) -> Result<(), String> {
    remove_path(&mcp_path(app)?, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path() -> PathBuf {
        std::env::temp_dir().join(format!("glyphra-mcp-{}.json", Uuid::new_v4()))
    }

    #[test]
    fn validates_transport_specific_fields() {
        let mut stdio = McpServerUpsert {
            id: None,
            name: " Files ".into(),
            transport: McpTransport::Stdio,
            command: Some(" npx ".into()),
            args: vec!["-y".into()],
            url: Some("https://ignored.example".into()),
            enabled: true,
        };
        validate_input(&mut stdio).unwrap();
        assert_eq!(stdio.name, "Files");
        assert_eq!(stdio.command.as_deref(), Some("npx"));
        assert_eq!(stdio.url, None);

        let mut invalid = McpServerUpsert {
            id: None,
            name: "Remote".into(),
            transport: McpTransport::Http,
            command: None,
            args: Vec::new(),
            url: Some("file:///tmp/server".into()),
            enabled: true,
        };
        assert!(validate_input(&mut invalid).is_err());
    }

    #[test]
    fn settings_file_roundtrip() {
        let path = temp_path();
        let file = McpFile {
            version: 1,
            servers: vec![McpServerRecord {
                id: "one".into(),
                name: "One".into(),
                transport: McpTransport::Http,
                command: None,
                args: Vec::new(),
                url: Some("https://example.com/mcp".into()),
                enabled: false,
                created_at: 1,
                updated_at: 2,
            }],
        };
        save_path(&path, &file).unwrap();
        let loaded = load_path(&path).unwrap();
        assert_eq!(loaded.version, 1);
        assert_eq!(loaded.servers.len(), 1);
        assert_eq!(loaded.servers[0].name, "One");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn crud_updates_toggles_and_removes_records() {
        let path = temp_path();
        let created = upsert_path(
            &path,
            McpServerUpsert {
                id: None,
                name: "Workspace".into(),
                transport: McpTransport::Stdio,
                command: Some("npx".into()),
                args: vec!["server".into()],
                url: None,
                enabled: true,
            },
        )
        .unwrap();
        assert!(created.enabled);

        let updated = upsert_path(
            &path,
            McpServerUpsert {
                id: Some(created.id.clone()),
                name: "Workspace".into(),
                transport: McpTransport::Stdio,
                command: Some("node".into()),
                args: vec!["server.js".into()],
                url: None,
                enabled: false,
            },
        )
        .unwrap();
        assert_eq!(updated.id, created.id);
        assert_eq!(updated.created_at, created.created_at);
        assert!(!updated.enabled);
        assert_eq!(load_path(&path).unwrap().servers.len(), 1);

        remove_path(&path, &created.id).unwrap();
        assert!(load_path(&path).unwrap().servers.is_empty());
        let _ = fs::remove_file(path);
    }
}
