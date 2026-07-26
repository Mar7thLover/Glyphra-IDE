//! Lazy, per-window Language Server Protocol clients.
//!
//! Servers are only spawned after a supported source file is opened. Each
//! `(window, workspace, language)` tuple owns one process so separate project
//! windows never share mutable document state.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Window};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout},
    sync::{oneshot, Mutex},
    time::timeout,
};
use ts_rs::TS;
use url::Url;

use crate::process_ext::tokio_command;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/LspServerStatus.ts")]
pub struct LspServerStatus {
    pub language_id: String,
    pub server: Option<String>,
    /// `ready`, `unavailable`, or `stopped`.
    pub state: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/LspDiagnostic.ts")]
pub struct LspDiagnostic {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub severity: String,
    pub message: String,
    pub source: Option<String>,
    pub code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/LspDiagnosticsEvent.ts")]
pub struct LspDiagnosticsEvent {
    pub language_id: String,
    pub path: String,
    pub diagnostics: Vec<LspDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/LspCompletionItem.ts")]
pub struct LspCompletionItem {
    pub label: String,
    pub detail: Option<String>,
    pub documentation: Option<String>,
    pub kind: Option<String>,
    pub insert_text: String,
    pub sort_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/LspHover.ts")]
pub struct LspHover {
    pub contents: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/LspLocation.ts")]
pub struct LspLocation {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub end_line: u32,
    pub end_column: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/LspTextEdit.ts")]
pub struct LspTextEdit {
    pub path: String,
    /// 1-based, like [`LspLocation`] and [`LspDiagnostic`] — the protocol's
    /// 0-based positions are converted at the boundary so every coordinate
    /// Glyphra hands the frontend counts the same way.
    pub start_line: u32,
    pub start_column: u32,
    pub end_line: u32,
    pub end_column: u32,
    pub new_text: String,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct ServerKey {
    window_label: String,
    root: PathBuf,
    language_id: String,
}

struct OpenDocument {
    uri: String,
    version: i32,
    content: String,
    references: usize,
}

struct ServerSpec {
    program: &'static str,
    args: &'static [&'static str],
}

pub(crate) struct LspServer {
    key: ServerKey,
    command_name: String,
    window: Window,
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    documents: Mutex<HashMap<PathBuf, OpenDocument>>,
    next_request: AtomicU64,
    alive: AtomicBool,
}

#[derive(Default)]
pub struct LspManager {
    servers: Mutex<HashMap<ServerKey, Arc<LspServer>>>,
}

impl LspManager {
    pub async fn live_count(&self) -> usize {
        self.servers
            .lock()
            .await
            .values()
            .filter(|server| server.alive.load(Ordering::Acquire))
            .count()
    }

    pub async fn open(
        self: &Arc<Self>,
        window: Window,
        root: &Path,
        path: &Path,
        language_id: &str,
        content: String,
    ) -> Result<LspServerStatus, String> {
        let root = canonical_workspace(root)?;
        let path = canonical_document(path, &root)?;
        let language_id = normalize_language_id(language_id);
        if server_specs(&language_id).is_empty() {
            return Ok(unavailable_status(
                &language_id,
                "No language server is configured for this file type.",
            ));
        }
        let key = ServerKey {
            window_label: window.label().to_owned(),
            root,
            language_id: language_id.clone(),
        };

        let existing = self.servers.lock().await.get(&key).cloned();
        let server = if existing
            .as_ref()
            .is_some_and(|server| server.alive.load(Ordering::Acquire))
        {
            existing.expect("checked above")
        } else {
            if existing.is_some() {
                self.servers.lock().await.remove(&key);
            }
            match start_server(key.clone(), window.clone()).await {
                Ok(server) => {
                    self.servers.lock().await.insert(key, Arc::clone(&server));
                    server
                }
                Err(error) => {
                    let status = unavailable_status(&language_id, &error);
                    let _ = window.emit("lsp-status", &status);
                    return Ok(status);
                }
            }
        };

        server.open_document(&path, &language_id, content).await?;
        let status = LspServerStatus {
            language_id,
            server: Some(server.command_name.clone()),
            state: "ready".into(),
            message: None,
        };
        let _ = window.emit("lsp-status", &status);
        Ok(status)
    }

    pub async fn change(
        &self,
        window_label: &str,
        root: &Path,
        path: &Path,
        language_id: &str,
        content: String,
    ) -> Result<bool, String> {
        let Some((server, path)) = self
            .server_for(window_label, root, path, language_id)
            .await?
        else {
            return Ok(false);
        };
        server.change_document(&path, content).await?;
        Ok(true)
    }

    pub async fn close(
        &self,
        window_label: &str,
        root: &Path,
        path: &Path,
        language_id: &str,
    ) -> Result<(), String> {
        let Some((server, path)) = self
            .server_for(window_label, root, path, language_id)
            .await?
        else {
            return Ok(());
        };
        server.close_document(&path).await?;
        // Servers like rust-analyzer hold hundreds of megabytes. Once the last
        // document is closed nothing can query them, so retire the process
        // instead of letting it sit on the idle-memory budget until the window
        // closes. Reopening a file starts a fresh one.
        if server.document_count().await == 0 {
            self.servers.lock().await.remove(&server.key);
            server.shutdown().await;
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn request(
        &self,
        window_label: &str,
        root: &Path,
        path: &Path,
        language_id: &str,
        content: String,
        method: &str,
        line: u32,
        character: u32,
        extra: Option<Value>,
    ) -> Result<Option<(Arc<LspServer>, Value)>, String> {
        let Some((server, path)) = self
            .server_for(window_label, root, path, language_id)
            .await?
        else {
            return Ok(None);
        };
        server.change_document(&path, content).await?;
        let uri = path_to_uri(&path)?;
        let mut params = json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });
        if let (Some(extra), Some(target)) = (extra, params.as_object_mut()) {
            if let Some(extra) = extra.as_object() {
                target.extend(extra.clone());
            }
        }
        let value = server.request(method, params).await?;
        Ok(Some((server, value)))
    }

    async fn server_for(
        &self,
        window_label: &str,
        root: &Path,
        path: &Path,
        language_id: &str,
    ) -> Result<Option<(Arc<LspServer>, PathBuf)>, String> {
        let root = canonical_workspace(root)?;
        let path = canonical_document(path, &root)?;
        let key = ServerKey {
            window_label: window_label.to_owned(),
            root,
            language_id: normalize_language_id(language_id),
        };
        let server = self.servers.lock().await.get(&key).cloned();
        Ok(server
            .filter(|server| server.alive.load(Ordering::Acquire))
            .map(|server| (server, path)))
    }

    pub async fn kill_window(&self, window_label: &str) -> usize {
        let servers = {
            let mut map = self.servers.lock().await;
            let keys = map
                .keys()
                .filter(|key| key.window_label == window_label)
                .cloned()
                .collect::<Vec<_>>();
            keys.into_iter()
                .filter_map(|key| map.remove(&key))
                .collect::<Vec<_>>()
        };
        let count = servers.len();
        for server in servers {
            server.shutdown().await;
        }
        count
    }
}

impl LspServer {
    async fn write(&self, value: &Value) -> Result<(), String> {
        let bytes = serde_json::to_vec(value)
            .map_err(|error| format!("failed to encode LSP message: {error}"))?;
        if bytes.len() > MAX_FRAME_BYTES {
            return Err("LSP message is too large".into());
        }
        let header = format!("Content-Length: {}\r\n\r\n", bytes.len());
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(header.as_bytes())
            .await
            .map_err(|error| format!("failed to write LSP header: {error}"))?;
        stdin
            .write_all(&bytes)
            .await
            .map_err(|error| format!("failed to write LSP body: {error}"))?;
        stdin
            .flush()
            .await
            .map_err(|error| format!("failed to flush LSP message: {error}"))
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.write(&json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        }))
        .await
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        if !self.alive.load(Ordering::Acquire) {
            return Err(format!("{} has stopped", self.command_name));
        }
        let id = self.next_request.fetch_add(1, Ordering::Relaxed) + 1;
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id, sender);
        if let Err(error) = self
            .write(&json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": method,
                "params": params
            }))
            .await
        {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }
        match timeout(REQUEST_TIMEOUT, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(format!("{} stopped before replying", self.command_name)),
            Err(_) => {
                self.pending.lock().await.remove(&id);
                let _ = self.notify("$/cancelRequest", json!({ "id": id })).await;
                Err(format!("{method} timed out"))
            }
        }
    }

    async fn open_document(
        &self,
        path: &Path,
        language_id: &str,
        content: String,
    ) -> Result<(), String> {
        let mut documents = self.documents.lock().await;
        if let Some(document) = documents.get_mut(path) {
            document.references += 1;
            if document.content == content {
                return Ok(());
            }
            document.version += 1;
            document.content.clone_from(&content);
            let uri = document.uri.clone();
            let version = document.version;
            drop(documents);
            return self
                .notify(
                    "textDocument/didChange",
                    json!({
                        "textDocument": { "uri": uri, "version": version },
                        "contentChanges": [{ "text": content }]
                    }),
                )
                .await;
        }
        let uri = path_to_uri(path)?;
        documents.insert(
            path.to_path_buf(),
            OpenDocument {
                uri: uri.clone(),
                version: 1,
                content: content.clone(),
                references: 1,
            },
        );
        drop(documents);
        self.notify(
            "textDocument/didOpen",
            json!({
                "textDocument": {
                    "uri": uri,
                    "languageId": language_id,
                    "version": 1,
                    "text": content
                }
            }),
        )
        .await
    }

    async fn change_document(&self, path: &Path, content: String) -> Result<(), String> {
        let mut documents = self.documents.lock().await;
        let Some(document) = documents.get_mut(path) else {
            return Ok(());
        };
        if document.content == content {
            return Ok(());
        }
        document.version += 1;
        document.content.clone_from(&content);
        let uri = document.uri.clone();
        let version = document.version;
        drop(documents);
        self.notify(
            "textDocument/didChange",
            json!({
                "textDocument": { "uri": uri, "version": version },
                "contentChanges": [{ "text": content }]
            }),
        )
        .await
    }

    async fn document_count(&self) -> usize {
        self.documents.lock().await.len()
    }

    async fn close_document(&self, path: &Path) -> Result<(), String> {
        let uri = {
            let mut documents = self.documents.lock().await;
            let Some(document) = documents.get_mut(path) else {
                return Ok(());
            };
            if document.references > 1 {
                document.references -= 1;
                return Ok(());
            }
            documents.remove(path).map(|document| document.uri)
        };
        if let Some(uri) = uri {
            self.notify(
                "textDocument/didClose",
                json!({ "textDocument": { "uri": uri } }),
            )
            .await?;
        }
        Ok(())
    }

    async fn shutdown(&self) {
        if !self.alive.load(Ordering::Acquire) {
            return;
        }
        let _ = timeout(SHUTDOWN_TIMEOUT, async {
            let _ = self.request("shutdown", Value::Null).await;
            let _ = self.notify("exit", Value::Null).await;
        })
        .await;
        self.alive.store(false, Ordering::Release);
        let _ = self.child.lock().await.kill().await;
        fail_pending(self, "language server stopped").await;
    }
}

async fn start_server(key: ServerKey, window: Window) -> Result<Arc<LspServer>, String> {
    let mut failures = Vec::new();
    for spec in server_specs(&key.language_id) {
        let mut command = tokio_command(spec.program);
        command
            .args(spec.args)
            .current_dir(&key.root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                failures.push(format!("{} was not found", spec.program));
                continue;
            }
            Err(error) => {
                failures.push(format!("{} failed to start: {error}", spec.program));
                continue;
            }
        };
        let Some(stdin) = child.stdin.take() else {
            failures.push(format!("{} did not provide stdin", spec.program));
            continue;
        };
        let Some(stdout) = child.stdout.take() else {
            failures.push(format!("{} did not provide stdout", spec.program));
            continue;
        };
        let stderr = child.stderr.take();
        let server = Arc::new(LspServer {
            key: key.clone(),
            command_name: spec.program.into(),
            window: window.clone(),
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            pending: Mutex::new(HashMap::new()),
            documents: Mutex::new(HashMap::new()),
            next_request: AtomicU64::new(0),
            alive: AtomicBool::new(true),
        });
        tauri::async_runtime::spawn(read_server(Arc::clone(&server), stdout));
        if let Some(stderr) = stderr {
            let name = server.command_name.clone();
            tauri::async_runtime::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::debug!(target: "lsp", server = %name, message = %line);
                }
            });
        }

        match initialize_server(&server).await {
            Ok(()) => return Ok(server),
            Err(error) => {
                failures.push(format!("{} initialization failed: {error}", spec.program));
                server.shutdown().await;
            }
        }
    }
    let hint = install_hint(&key.language_id);
    let detail = if failures.is_empty() {
        hint.to_string()
    } else {
        format!("{}. {hint}", failures.join("; "))
    };
    Err(detail)
}

async fn initialize_server(server: &Arc<LspServer>) -> Result<(), String> {
    let root_uri = path_to_uri(&server.key.root)?;
    let result = server
        .request(
            "initialize",
            json!({
                "processId": std::process::id(),
                "clientInfo": { "name": "Glyphra", "version": env!("CARGO_PKG_VERSION") },
                "locale": "en",
                "rootUri": root_uri,
                "workspaceFolders": [{
                    "uri": root_uri,
                    "name": server.key.root.file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("workspace")
                }],
                "capabilities": {
                    "general": { "positionEncodings": ["utf-16"] },
                    "workspace": {
                        "workspaceFolders": true,
                        "configuration": true,
                        "applyEdit": false,
                        "workspaceEdit": { "documentChanges": true }
                    },
                    "textDocument": {
                        "synchronization": { "didSave": true },
                        "completion": {
                            "completionItem": {
                                "documentationFormat": ["markdown", "plaintext"],
                                "snippetSupport": false
                            }
                        },
                        "hover": { "contentFormat": ["markdown", "plaintext"] },
                        "definition": { "linkSupport": false },
                        "references": {},
                        "rename": { "prepareSupport": false },
                        "publishDiagnostics": {
                            "relatedInformation": true,
                            "versionSupport": true
                        }
                    }
                }
            }),
        )
        .await?;
    if result.get("capabilities").is_none() {
        return Err("initialize response did not contain capabilities".into());
    }
    server.notify("initialized", json!({})).await?;
    server
        .notify(
            "workspace/didChangeConfiguration",
            json!({ "settings": {} }),
        )
        .await
}

async fn read_server(server: Arc<LspServer>, stdout: ChildStdout) {
    let mut reader = BufReader::new(stdout);
    loop {
        match read_frame(&mut reader).await {
            Ok(Some(message)) => handle_message(&server, message).await,
            Ok(None) => break,
            Err(error) => {
                tracing::warn!(
                    target: "lsp",
                    server = %server.command_name,
                    %error,
                    "language server protocol stream failed"
                );
                break;
            }
        }
    }
    server.alive.store(false, Ordering::Release);
    fail_pending(&server, "language server exited").await;
    let status = LspServerStatus {
        language_id: server.key.language_id.clone(),
        server: Some(server.command_name.clone()),
        state: "stopped".into(),
        message: Some("The language server process exited.".into()),
    };
    let _ = server.window.emit("lsp-status", status);
}

async fn read_frame<R: tokio::io::AsyncBufRead + Unpin>(
    reader: &mut R,
) -> Result<Option<Value>, String> {
    let mut content_length = None;
    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .await
            .map_err(|error| format!("failed to read LSP header: {error}"))?;
        if read == 0 {
            return Ok(None);
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.eq_ignore_ascii_case("content-length") {
            content_length = value.trim().parse::<usize>().ok();
        }
    }
    let length = content_length.ok_or_else(|| "LSP frame omitted Content-Length".to_string())?;
    if length > MAX_FRAME_BYTES {
        return Err(format!("LSP frame exceeds {MAX_FRAME_BYTES} bytes"));
    }
    let mut body = vec![0_u8; length];
    reader
        .read_exact(&mut body)
        .await
        .map_err(|error| format!("failed to read LSP body: {error}"))?;
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|error| format!("failed to decode LSP JSON: {error}"))
}

async fn handle_message(server: &Arc<LspServer>, message: Value) {
    if let Some(id) = message.get("id").and_then(Value::as_u64) {
        if message.get("method").is_none() {
            if let Some(sender) = server.pending.lock().await.remove(&id) {
                let result = if let Some(error) = message.get("error") {
                    Err(error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("language server request failed")
                        .to_string())
                } else {
                    Ok(message.get("result").cloned().unwrap_or(Value::Null))
                };
                let _ = sender.send(result);
            }
            return;
        }
    }

    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return;
    };
    if method == "textDocument/publishDiagnostics" {
        publish_diagnostics(server, message.get("params").cloned().unwrap_or_default());
        return;
    }
    let Some(id) = message.get("id").cloned() else {
        return;
    };
    let params = message.get("params").cloned().unwrap_or_default();
    let response = client_request_response(server, method, &params);
    let mut payload = json!({ "jsonrpc": "2.0", "id": id });
    if let Some(object) = payload.as_object_mut() {
        object.extend(response);
    }
    let _ = server.write(&payload).await;
}

fn client_request_response(
    server: &LspServer,
    method: &str,
    params: &Value,
) -> serde_json::Map<String, Value> {
    let mut response = serde_json::Map::new();
    match method {
        "workspace/configuration" => {
            let count = params
                .get("items")
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            response.insert("result".into(), Value::Array(vec![Value::Null; count]));
        }
        "workspace/workspaceFolders" => {
            let uri = path_to_uri(&server.key.root).unwrap_or_default();
            response.insert(
                "result".into(),
                json!([{
                    "uri": uri,
                    "name": server.key.root.file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("workspace")
                }]),
            );
        }
        "client/registerCapability"
        | "client/unregisterCapability"
        | "window/workDoneProgress/create" => {
            response.insert("result".into(), Value::Null);
        }
        "workspace/applyEdit" => {
            response.insert(
                "result".into(),
                json!({ "applied": false, "failureReason": "Glyphra requests edits explicitly" }),
            );
        }
        _ => {
            response.insert(
                "error".into(),
                json!({ "code": -32601, "message": format!("Unsupported client method: {method}") }),
            );
        }
    }
    response
}

fn publish_diagnostics(server: &LspServer, params: Value) {
    let Some(uri) = params.get("uri").and_then(Value::as_str) else {
        return;
    };
    let Ok(path) = uri_to_path(uri) else {
        return;
    };
    if !path_is_within(&path, &server.key.root) {
        return;
    }
    let diagnostics = params
        .get("diagnostics")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| parse_diagnostic(&path, value))
        .take(500)
        .collect::<Vec<_>>();
    let event = LspDiagnosticsEvent {
        language_id: server.key.language_id.clone(),
        path: path.to_string_lossy().into_owned(),
        diagnostics,
    };
    let _ = server.window.emit("lsp-diagnostics", event);
}

fn parse_diagnostic(path: &Path, value: &Value) -> Option<LspDiagnostic> {
    let range = value.get("range")?;
    let start = range.get("start")?;
    let end = range.get("end")?;
    let severity = match value.get("severity").and_then(Value::as_u64) {
        Some(1) => "error",
        Some(2) => "warning",
        _ => "info",
    };
    Some(LspDiagnostic {
        path: path.to_string_lossy().into_owned(),
        line: number(start, "line").saturating_add(1),
        column: number(start, "character").saturating_add(1),
        end_line: number(end, "line").saturating_add(1),
        end_column: number(end, "character").saturating_add(1),
        severity: severity.into(),
        message: value.get("message")?.as_str()?.to_string(),
        source: value
            .get("source")
            .and_then(Value::as_str)
            .map(str::to_owned),
        code: value.get("code").and_then(value_to_string),
    })
}

pub fn parse_completion_items(value: Value) -> Vec<LspCompletionItem> {
    let values = value
        .as_array()
        .or_else(|| value.get("items").and_then(Value::as_array))
        .cloned()
        .unwrap_or_default();
    values
        .iter()
        .filter_map(|item| {
            let label = item.get("label")?.as_str()?.to_string();
            let text_edit = item.get("textEdit");
            let insert_text = strip_snippet_placeholders(
                text_edit
                    .and_then(|edit| edit.get("newText"))
                    .and_then(Value::as_str)
                    .or_else(|| item.get("insertText").and_then(Value::as_str))
                    .unwrap_or(&label),
            );
            Some(LspCompletionItem {
                label,
                detail: item
                    .get("detail")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                documentation: item.get("documentation").and_then(markup_text),
                kind: item
                    .get("kind")
                    .and_then(Value::as_u64)
                    .map(completion_kind)
                    .map(str::to_owned),
                insert_text,
                sort_text: item
                    .get("sortText")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            })
        })
        .take(500)
        .collect()
}

pub fn parse_hover(value: Value) -> Option<LspHover> {
    let contents = value.get("contents").and_then(markup_text)?;
    if contents.trim().is_empty() {
        None
    } else {
        Some(LspHover { contents })
    }
}

pub fn parse_locations(value: Value, root: &Path) -> Vec<LspLocation> {
    let values = if value.is_array() {
        value.as_array().cloned().unwrap_or_default()
    } else if value.is_null() {
        Vec::new()
    } else {
        vec![value]
    };
    values
        .iter()
        .filter_map(|location| {
            let uri = location
                .get("uri")
                .or_else(|| location.get("targetUri"))?
                .as_str()?;
            let path = uri_to_path(uri).ok()?;
            if !path_is_within(&path, root) {
                return None;
            }
            let range = location
                .get("range")
                .or_else(|| location.get("targetSelectionRange"))
                .or_else(|| location.get("targetRange"))?;
            Some(location_from_range(&path, range))
        })
        .take(1000)
        .collect()
}

pub fn parse_workspace_edit(value: Value, root: &Path) -> Vec<LspTextEdit> {
    let mut output = Vec::new();
    if let Some(changes) = value.get("changes").and_then(Value::as_object) {
        for (uri, edits) in changes {
            push_text_edits(&mut output, root, uri, edits);
        }
    }
    if let Some(changes) = value.get("documentChanges").and_then(Value::as_array) {
        for change in changes {
            let Some(uri) = change
                .get("textDocument")
                .and_then(|document| document.get("uri"))
                .and_then(Value::as_str)
            else {
                continue;
            };
            push_text_edits(
                &mut output,
                root,
                uri,
                change.get("edits").unwrap_or(&Value::Null),
            );
        }
    }
    output.truncate(10_000);
    output
}

fn push_text_edits(output: &mut Vec<LspTextEdit>, root: &Path, uri: &str, edits: &Value) {
    let Ok(path) = uri_to_path(uri) else {
        return;
    };
    if !path_is_within(&path, root) {
        return;
    }
    let Some(edits) = edits.as_array() else {
        return;
    };
    for edit in edits {
        let Some(range) = edit.get("range") else {
            continue;
        };
        let Some(start) = range.get("start") else {
            continue;
        };
        let Some(end) = range.get("end") else {
            continue;
        };
        let Some(new_text) = edit.get("newText").and_then(Value::as_str) else {
            continue;
        };
        output.push(LspTextEdit {
            path: path.to_string_lossy().into_owned(),
            start_line: number(start, "line").saturating_add(1),
            start_column: number(start, "character").saturating_add(1),
            end_line: number(end, "line").saturating_add(1),
            end_column: number(end, "character").saturating_add(1),
            new_text: new_text.to_string(),
        });
    }
}

fn location_from_range(path: &Path, range: &Value) -> LspLocation {
    let start = range.get("start").unwrap_or(&Value::Null);
    let end = range.get("end").unwrap_or(&Value::Null);
    LspLocation {
        path: path.to_string_lossy().into_owned(),
        line: number(start, "line").saturating_add(1),
        column: number(start, "character").saturating_add(1),
        end_line: number(end, "line").saturating_add(1),
        end_column: number(end, "character").saturating_add(1),
    }
}

fn markup_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    if let Some(text) = value.get("value").and_then(Value::as_str) {
        return Some(text.to_string());
    }
    value.as_array().map(|parts| {
        parts
            .iter()
            .filter_map(markup_text)
            .collect::<Vec<_>>()
            .join("\n\n")
    })
}

fn strip_snippet_placeholders(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(character) = chars.next() {
        if character != '$' {
            output.push(character);
            continue;
        }
        match chars.peek().copied() {
            Some('{') => {
                chars.next();
                let mut body = String::new();
                for next in chars.by_ref() {
                    if next == '}' {
                        break;
                    }
                    body.push(next);
                }
                if let Some((_, default)) = body.split_once(':') {
                    output.push_str(default);
                }
            }
            Some(next) if next.is_ascii_digit() => {
                while chars.peek().is_some_and(|next| next.is_ascii_digit()) {
                    chars.next();
                }
            }
            _ => output.push('$'),
        }
    }
    output
}

fn completion_kind(kind: u64) -> &'static str {
    match kind {
        2 | 3 => "function",
        4 => "constructor",
        5 | 10 => "property",
        6 => "variable",
        7 => "class",
        8 => "interface",
        9 => "module",
        12 => "value",
        13 => "enum",
        14 => "keyword",
        17 => "file",
        21 => "constant",
        22 => "struct",
        23 => "event",
        25 => "type",
        _ => "text",
    }
}

fn value_to_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.as_i64().map(|number| number.to_string()))
}

fn number(value: &Value, name: &str) -> u32 {
    value
        .get(name)
        .and_then(Value::as_u64)
        .and_then(|number| u32::try_from(number).ok())
        .unwrap_or_default()
}

async fn fail_pending(server: &LspServer, message: &str) {
    let pending = std::mem::take(&mut *server.pending.lock().await);
    for (_, sender) in pending {
        let _ = sender.send(Err(message.to_string()));
    }
}

fn server_specs(language_id: &str) -> Vec<ServerSpec> {
    match language_id {
        "rust" => vec![ServerSpec {
            program: "rust-analyzer",
            args: &[],
        }],
        "typescript" | "typescriptreact" | "javascript" | "javascriptreact" => {
            vec![ServerSpec {
                program: "typescript-language-server",
                args: &["--stdio"],
            }]
        }
        "python" => vec![
            ServerSpec {
                program: "pyright-langserver",
                args: &["--stdio"],
            },
            ServerSpec {
                program: "pylsp",
                args: &[],
            },
        ],
        "go" => vec![ServerSpec {
            program: "gopls",
            args: &[],
        }],
        "c" | "cpp" | "objective-c" | "objective-cpp" => vec![ServerSpec {
            program: "clangd",
            args: &[],
        }],
        "java" => vec![ServerSpec {
            program: "jdtls",
            args: &[],
        }],
        "json" => vec![ServerSpec {
            program: "vscode-json-language-server",
            args: &["--stdio"],
        }],
        "html" => vec![ServerSpec {
            program: "vscode-html-language-server",
            args: &["--stdio"],
        }],
        "css" | "scss" | "less" => vec![ServerSpec {
            program: "vscode-css-language-server",
            args: &["--stdio"],
        }],
        "yaml" => vec![ServerSpec {
            program: "yaml-language-server",
            args: &["--stdio"],
        }],
        "lua" => vec![ServerSpec {
            program: "lua-language-server",
            args: &[],
        }],
        _ => Vec::new(),
    }
}

fn install_hint(language_id: &str) -> &'static str {
    match language_id {
        "rust" => "Install rust-analyzer and ensure it is on PATH",
        "typescript" | "typescriptreact" | "javascript" | "javascriptreact" => {
            "Install typescript-language-server and typescript on PATH"
        }
        "python" => "Install pyright-langserver or python-lsp-server on PATH",
        "go" => "Install gopls and ensure it is on PATH",
        "c" | "cpp" | "objective-c" | "objective-cpp" => "Install clangd and ensure it is on PATH",
        "java" => "Install Eclipse JDT Language Server (jdtls) on PATH",
        "json" | "html" | "css" | "scss" | "less" => {
            "Install the matching vscode-langservers-extracted server on PATH"
        }
        "yaml" => "Install yaml-language-server on PATH",
        "lua" => "Install lua-language-server on PATH",
        _ => "No language server is configured",
    }
}

fn unavailable_status(language_id: &str, message: &str) -> LspServerStatus {
    LspServerStatus {
        language_id: language_id.into(),
        server: None,
        state: "unavailable".into(),
        message: Some(message.into()),
    }
}

fn normalize_language_id(language_id: &str) -> String {
    language_id.trim().to_ascii_lowercase()
}

/// `canonicalize` yields extended-length (`\\?\`) paths on Windows. Language
/// servers echo back plain paths in URIs, and every path here is also compared
/// against frontend tab paths, so normalize to the plain form at the boundary —
/// otherwise `path_is_within` silently rejects every diagnostic.
fn canonical_workspace(root: &Path) -> Result<PathBuf, String> {
    root.canonicalize()
        .map_err(|error| format!("invalid LSP workspace {}: {error}", root.display()))
        .and_then(|root| {
            if root.is_dir() {
                Ok(crate::paths::simplified(&root))
            } else {
                Err(format!(
                    "LSP workspace is not a directory: {}",
                    root.display()
                ))
            }
        })
}

fn canonical_document(path: &Path, root: &Path) -> Result<PathBuf, String> {
    let path = path
        .canonicalize()
        .map_err(|error| format!("invalid LSP document {}: {error}", path.display()))?;
    let path = crate::paths::simplified(&path);
    if !path_is_within(&path, root) {
        return Err("LSP document is outside the project".into());
    }
    Ok(path)
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn path_to_uri(path: &Path) -> Result<String, String> {
    Url::from_file_path(path)
        .map(String::from)
        .map_err(|()| format!("failed to convert path to URI: {}", path.display()))
}

fn uri_to_path(uri: &str) -> Result<PathBuf, String> {
    Url::parse(uri)
        .map_err(|error| format!("invalid LSP URI: {error}"))?
        .to_file_path()
        .map_err(|()| "LSP URI is not a local file".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_snippet_placeholders_without_executing_them() {
        assert_eq!(
            strip_snippet_placeholders("call(${1:value}, $2)$0"),
            "call(value, )"
        );
    }

    #[test]
    fn parses_completion_list_and_markup() {
        let items = parse_completion_items(json!({
            "items": [{
                "label": "collect",
                "kind": 2,
                "insertText": "collect(${1:value})",
                "documentation": { "kind": "markdown", "value": "**Collect**" }
            }]
        }));
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].insert_text, "collect(value)");
        assert_eq!(items[0].kind.as_deref(), Some("function"));
        assert_eq!(items[0].documentation.as_deref(), Some("**Collect**"));
    }

    async fn frames_from(bytes: &[u8]) -> Vec<Result<Option<Value>, String>> {
        let mut reader = BufReader::new(std::io::Cursor::new(bytes.to_vec()));
        let mut output = Vec::new();
        loop {
            let frame = read_frame(&mut reader).await;
            let done = !matches!(frame, Ok(Some(_)));
            output.push(frame);
            if done {
                return output;
            }
        }
    }

    #[tokio::test]
    async fn reads_consecutive_frames_and_ignores_extra_headers() {
        let body_one = br#"{"jsonrpc":"2.0","id":1,"result":{"capabilities":{}}}"#;
        let body_two = br#"{"jsonrpc":"2.0","method":"initialized","params":{}}"#;
        let mut stream = Vec::new();
        stream.extend_from_slice(
            format!(
                "Content-Length: {}\r\nContent-Type: application/vscode-jsonrpc\r\n\r\n",
                body_one.len()
            )
            .as_bytes(),
        );
        stream.extend_from_slice(body_one);
        stream.extend_from_slice(format!("content-length: {}\r\n\r\n", body_two.len()).as_bytes());
        stream.extend_from_slice(body_two);

        let frames = frames_from(&stream).await;
        assert_eq!(frames.len(), 3);
        assert_eq!(frames[0].as_ref().unwrap().as_ref().unwrap()["id"], 1);
        assert_eq!(
            frames[1].as_ref().unwrap().as_ref().unwrap()["method"],
            "initialized"
        );
        // Clean end of stream, not an error.
        assert!(matches!(frames[2], Ok(None)));
    }

    #[tokio::test]
    async fn rejects_frames_without_a_length_and_oversized_frames() {
        let missing = frames_from(b"Content-Type: application/json\r\n\r\n{}").await;
        assert!(missing[0].is_err());

        let oversized =
            frames_from(format!("Content-Length: {}\r\n\r\n", MAX_FRAME_BYTES + 1).as_bytes())
                .await;
        assert!(oversized[0].is_err());
    }

    #[test]
    fn canonical_paths_survive_a_uri_round_trip() {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("main.rs");
        std::fs::write(&file, "").unwrap();

        let workspace = canonical_workspace(root.path()).unwrap();
        let document = canonical_document(&file, &workspace).unwrap();
        let echoed = uri_to_path(&path_to_uri(&document).unwrap()).unwrap();

        // Servers echo back the URI they were handed. On Windows `canonicalize`
        // yields `\\?\C:\…` while a decoded URI yields `C:\…`, so without
        // normalizing both to the plain form this containment check fails and
        // every diagnostic is silently dropped.
        assert!(path_is_within(&echoed, &workspace));
        assert!(!workspace.to_string_lossy().starts_with(r"\\?\"));
        assert!(!document.to_string_lossy().starts_with(r"\\?\"));
    }

    #[test]
    fn documents_outside_the_workspace_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let outside = root.path().parent().unwrap().join("glyphra-lsp-outside.rs");
        std::fs::write(&outside, "").unwrap();
        let workspace = canonical_workspace(root.path()).unwrap();

        assert!(canonical_document(&outside, &workspace).is_err());
        let _ = std::fs::remove_file(outside);
    }

    #[test]
    fn workspace_edits_are_restricted_to_the_project() {
        let root = tempfile::tempdir().unwrap();
        let inside = root.path().join("inside.rs");
        let outside = root.path().parent().unwrap().join("outside.rs");
        std::fs::write(&inside, "").unwrap();
        std::fs::write(&outside, "").unwrap();
        let value = json!({
            "changes": {
                path_to_uri(&inside).unwrap(): [{
                    "range": {
                        "start": { "line": 0, "character": 1 },
                        "end": { "line": 0, "character": 2 }
                    },
                    "newText": "x"
                }],
                path_to_uri(&outside).unwrap(): [{
                    "range": {
                        "start": { "line": 0, "character": 0 },
                        "end": { "line": 0, "character": 0 }
                    },
                    "newText": "unsafe"
                }]
            }
        });
        let edits = parse_workspace_edit(value, root.path());
        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0].new_text, "x");
        // Protocol positions are 0-based; Glyphra reports 1-based everywhere.
        assert_eq!((edits[0].start_line, edits[0].start_column), (1, 2));
        assert_eq!((edits[0].end_line, edits[0].end_column), (1, 3));
        let _ = std::fs::remove_file(outside);
    }
}
