use std::{collections::HashMap, fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Manager};
use ts_rs::TS;
use uuid::Uuid;

use crate::vault;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/ProviderKind.ts")]
pub enum ProviderKind {
    #[serde(rename = "codex-login")]
    CodexLogin,
    #[serde(rename = "openai-key")]
    OpenaiKey,
    #[serde(rename = "custom-openai")]
    CustomOpenai,
    #[serde(rename = "claude-subscription")]
    ClaudeSubscription,
    #[serde(rename = "anthropic-key")]
    AnthropicKey,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/ProviderRecord.ts")]
pub struct ProviderRecord {
    pub id: String,
    pub kind: ProviderKind,
    pub name: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
    /// True when a secret is stored for this provider (never the secret itself).
    pub has_secret: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ProviderFile {
    providers: Vec<ProviderRecord>,
}

fn providers_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("config dir: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("create config dir: {err}"))?;
    Ok(dir.join("providers.json"))
}

fn load_file(app: &AppHandle) -> Result<ProviderFile, String> {
    let path = providers_path(app)?;
    if !path.exists() {
        return Ok(ProviderFile::default());
    }
    let data = fs::read_to_string(&path).map_err(|err| format!("read providers: {err}"))?;
    Ok(serde_json::from_str(&data).unwrap_or_default())
}

fn save_file(app: &AppHandle, file: &ProviderFile) -> Result<(), String> {
    let path = providers_path(app)?;
    let data = serde_json::to_string_pretty(file).map_err(|err| format!("serialize: {err}"))?;
    fs::write(path, data).map_err(|err| format!("write providers: {err}"))
}

pub fn list(app: &AppHandle) -> Result<Vec<ProviderRecord>, String> {
    let mut file = load_file(app)?;
    for provider in &mut file.providers {
        provider.has_secret = vault::probe(app, &provider.id)?;
    }
    Ok(file.providers)
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/ProviderUpsert.ts")]
pub struct ProviderUpsert {
    pub id: Option<String>,
    pub kind: ProviderKind,
    pub name: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
    /// Optional secret; omitted/null leaves the existing vault entry untouched.
    pub secret: Option<String>,
}

pub fn upsert(app: &AppHandle, input: ProviderUpsert) -> Result<ProviderRecord, String> {
    let mut file = load_file(app)?;
    let id = input
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    if let Some(secret) = input.secret.as_ref().filter(|s| !s.is_empty()) {
        vault::set_secret(app, &id, secret)?;
    }

    let record = ProviderRecord {
        id: id.clone(),
        kind: input.kind,
        name: input.name,
        base_url: input.base_url,
        model: input.model,
        has_secret: vault::probe(app, &id)?,
    };

    if let Some(existing) = file.providers.iter_mut().find(|p| p.id == id) {
        *existing = record.clone();
    } else {
        file.providers.push(record.clone());
    }
    save_file(app, &file)?;
    Ok(record)
}

pub fn remove(app: &AppHandle, id: &str) -> Result<(), String> {
    let mut file = load_file(app)?;
    file.providers.retain(|p| p.id != id);
    save_file(app, &file)?;
    vault::clear(app, id)?;
    Ok(())
}

/// Build env vars for spawning codex-acp with a custom OpenAI-compatible provider.
pub fn materialize_spawn_env(
    app: &AppHandle,
    provider_id: &str,
) -> Result<HashMap<String, String>, String> {
    let file = load_file(app)?;
    let provider = file
        .providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("unknown provider {provider_id}"))?
        .clone();

    let mut env = HashMap::new();
    match provider.kind {
        ProviderKind::CustomOpenai | ProviderKind::OpenaiKey => {
            let secret = vault::read_secret(app, &provider.id)?
                .ok_or_else(|| "provider secret missing".to_string())?;
            let env_key = format!(
                "GLYPHRA_PK_{}",
                provider.id.replace('-', "_").to_uppercase()
            );
            env.insert(env_key.clone(), secret);

            let base_url = provider
                .base_url
                .unwrap_or_else(|| "https://api.openai.com/v1".into());
            let model = provider.model.unwrap_or_else(|| "gpt-5".into());
            let short = &provider.id[..provider.id.len().min(8)];
            let provider_key = format!("glyphra_{short}");
            let config = json!({
                "model_providers": {
                    provider_key.clone(): {
                        "base_url": base_url,
                        "env_key": env_key,
                        "wire_api": "responses"
                    }
                },
                "model_provider": provider_key,
                "model": model
            });
            env.insert("CODEX_CONFIG".into(), config.to_string());
            env.insert(
                "OPENAI_API_KEY".into(),
                env.get(&env_key).cloned().unwrap_or_default(),
            );
        }
        ProviderKind::AnthropicKey => {
            let secret = vault::read_secret(app, &provider.id)?
                .ok_or_else(|| "provider secret missing".to_string())?;
            env.insert("ANTHROPIC_API_KEY".into(), secret);
        }
        ProviderKind::CodexLogin | ProviderKind::ClaudeSubscription => {
            // Subscription login lives in the CLI home directory; nothing to inject.
        }
    }
    Ok(env)
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/ProviderTestResult.ts")]
pub struct ProviderTestResult {
    pub ok: bool,
    pub status: u16,
    pub detail: String,
}

/// Kind-aware connectivity check.
/// - openai / custom-openai → POST `{base}/responses` (Responses API)
/// - anthropic-key → POST `{base}/messages` (Anthropic Messages)
/// - subscription / login kinds → confirm CLI-login path (no HTTP probe)
pub async fn test_connection(
    app: &AppHandle,
    provider_id: &str,
) -> Result<ProviderTestResult, String> {
    let file = load_file(app)?;
    let provider = file
        .providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or_else(|| format!("unknown provider {provider_id}"))?
        .clone();

    match provider.kind {
        ProviderKind::CodexLogin => {
            return Ok(ProviderTestResult {
                ok: true,
                status: 0,
                detail: "Uses Codex CLI login (chatgpt). Run `codex` once in a terminal to sign in — Glyphra does not store a key."
                    .into(),
            });
        }
        ProviderKind::ClaudeSubscription => {
            return Ok(ProviderTestResult {
                ok: true,
                status: 0,
                detail: "Uses Claude Code subscription login. Run `claude` once to sign in — Glyphra does not store a key."
                    .into(),
            });
        }
        ProviderKind::AnthropicKey => {
            return test_anthropic(app, &provider).await;
        }
        ProviderKind::OpenaiKey | ProviderKind::CustomOpenai => {}
    }

    let base = provider
        .base_url
        .as_deref()
        .unwrap_or("https://api.openai.com/v1")
        .trim_end_matches('/');
    let url = format!("{base}/responses");
    let secret = vault::read_secret(app, &provider.id)?.unwrap_or_default();
    if secret.is_empty() {
        return Ok(ProviderTestResult {
            ok: false,
            status: 0,
            detail: "No API key stored. Save a key first, then test again.".into(),
        });
    }

    let model = provider
        .model
        .clone()
        .unwrap_or_else(|| "gpt-4.1-mini".into());
    let body = json!({
        "model": model,
        "input": "ping",
        "max_output_tokens": 16
    });

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .bearer_auth(&secret)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|err| format!("request failed: {err}"))?;

    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    let detail = text.chars().take(240).collect::<String>();
    let hint = if !(200..300).contains(&status) {
        " Endpoint must support OpenAI Responses API (not Chat Completions)."
    } else {
        ""
    };
    Ok(ProviderTestResult {
        ok: (200..300).contains(&status),
        status,
        detail: if detail.is_empty() {
            format!("HTTP {status}{hint}")
        } else {
            format!("{detail}{hint}")
        },
    })
}

async fn test_anthropic(
    app: &AppHandle,
    provider: &ProviderRecord,
) -> Result<ProviderTestResult, String> {
    let secret = vault::read_secret(app, &provider.id)?.unwrap_or_default();
    if secret.is_empty() {
        return Ok(ProviderTestResult {
            ok: false,
            status: 0,
            detail: "No Anthropic API key stored.".into(),
        });
    }
    let base = provider
        .base_url
        .as_deref()
        .unwrap_or("https://api.anthropic.com/v1")
        .trim_end_matches('/');
    let url = format!("{base}/messages");
    let model = provider
        .model
        .clone()
        .unwrap_or_else(|| "claude-sonnet-4-20250514".into());
    let body = json!({
        "model": model,
        "max_tokens": 16,
        "messages": [{"role": "user", "content": "ping"}]
    });
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("x-api-key", &secret)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|err| format!("request failed: {err}"))?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    let detail = text.chars().take(240).collect::<String>();
    Ok(ProviderTestResult {
        ok: (200..300).contains(&status),
        status,
        detail: if detail.is_empty() {
            format!("HTTP {status}")
        } else {
            detail
        },
    })
}
