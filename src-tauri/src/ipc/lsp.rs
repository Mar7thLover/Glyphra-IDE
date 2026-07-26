use std::{path::Path, sync::Arc};

use serde_json::{json, Value};
use tauri::{State, Window};

use crate::lsp::{
    parse_completion_items, parse_hover, parse_locations, parse_workspace_edit, LspCompletionItem,
    LspHover, LspLocation, LspManager, LspServerStatus, LspTextEdit,
};

#[tauri::command]
pub async fn lsp_open(
    window: Window,
    manager: State<'_, Arc<LspManager>>,
    project_path: String,
    path: String,
    language_id: String,
    content: String,
) -> Result<LspServerStatus, String> {
    manager
        .open(
            window,
            Path::new(&project_path),
            Path::new(&path),
            &language_id,
            content,
        )
        .await
}

#[tauri::command]
pub async fn lsp_change(
    window: Window,
    manager: State<'_, Arc<LspManager>>,
    project_path: String,
    path: String,
    language_id: String,
    content: String,
) -> Result<bool, String> {
    manager
        .change(
            window.label(),
            Path::new(&project_path),
            Path::new(&path),
            &language_id,
            content,
        )
        .await
}

#[tauri::command]
pub async fn lsp_close(
    window: Window,
    manager: State<'_, Arc<LspManager>>,
    project_path: String,
    path: String,
    language_id: String,
) -> Result<(), String> {
    manager
        .close(
            window.label(),
            Path::new(&project_path),
            Path::new(&path),
            &language_id,
        )
        .await
}

#[allow(clippy::too_many_arguments)]
async fn request_at(
    window: &Window,
    manager: &Arc<LspManager>,
    project_path: &str,
    path: &str,
    language_id: &str,
    content: String,
    method: &str,
    line: u32,
    character: u32,
    extra: Option<Value>,
) -> Result<Option<Value>, String> {
    manager
        .request(
            window.label(),
            Path::new(project_path),
            Path::new(path),
            language_id,
            content,
            method,
            line,
            character,
            extra,
        )
        .await
        .map(|result| result.map(|(_, value)| value))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn lsp_completion(
    window: Window,
    manager: State<'_, Arc<LspManager>>,
    project_path: String,
    path: String,
    language_id: String,
    content: String,
    line: u32,
    character: u32,
) -> Result<Vec<LspCompletionItem>, String> {
    Ok(request_at(
        &window,
        manager.inner(),
        &project_path,
        &path,
        &language_id,
        content,
        "textDocument/completion",
        line,
        character,
        Some(json!({ "context": { "triggerKind": 1 } })),
    )
    .await?
    .map(parse_completion_items)
    .unwrap_or_default())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn lsp_hover(
    window: Window,
    manager: State<'_, Arc<LspManager>>,
    project_path: String,
    path: String,
    language_id: String,
    content: String,
    line: u32,
    character: u32,
) -> Result<Option<LspHover>, String> {
    Ok(request_at(
        &window,
        manager.inner(),
        &project_path,
        &path,
        &language_id,
        content,
        "textDocument/hover",
        line,
        character,
        None,
    )
    .await?
    .and_then(parse_hover))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn lsp_definition(
    window: Window,
    manager: State<'_, Arc<LspManager>>,
    project_path: String,
    path: String,
    language_id: String,
    content: String,
    line: u32,
    character: u32,
) -> Result<Vec<LspLocation>, String> {
    let value = request_at(
        &window,
        manager.inner(),
        &project_path,
        &path,
        &language_id,
        content,
        "textDocument/definition",
        line,
        character,
        None,
    )
    .await?;
    Ok(value
        .map(|value| parse_locations(value, Path::new(&project_path)))
        .unwrap_or_default())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn lsp_references(
    window: Window,
    manager: State<'_, Arc<LspManager>>,
    project_path: String,
    path: String,
    language_id: String,
    content: String,
    line: u32,
    character: u32,
) -> Result<Vec<LspLocation>, String> {
    let value = request_at(
        &window,
        manager.inner(),
        &project_path,
        &path,
        &language_id,
        content,
        "textDocument/references",
        line,
        character,
        Some(json!({ "context": { "includeDeclaration": true } })),
    )
    .await?;
    Ok(value
        .map(|value| parse_locations(value, Path::new(&project_path)))
        .unwrap_or_default())
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn lsp_rename(
    window: Window,
    manager: State<'_, Arc<LspManager>>,
    project_path: String,
    path: String,
    language_id: String,
    content: String,
    line: u32,
    character: u32,
    new_name: String,
) -> Result<Vec<LspTextEdit>, String> {
    let new_name = new_name.trim();
    if new_name.is_empty() || new_name.len() > 256 || new_name.contains(['\r', '\n', '\0']) {
        return Err("invalid rename target".into());
    }
    let value = request_at(
        &window,
        manager.inner(),
        &project_path,
        &path,
        &language_id,
        content,
        "textDocument/rename",
        line,
        character,
        Some(json!({ "newName": new_name })),
    )
    .await?;
    Ok(value
        .map(|value| parse_workspace_edit(value, Path::new(&project_path)))
        .unwrap_or_default())
}
