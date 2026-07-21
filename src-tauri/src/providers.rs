use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Manager};
use tokio::process::Command;
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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/ProviderUsageWindow.ts")]
pub struct ProviderUsageWindow {
    pub label: String,
    pub used_percent: Option<f64>,
    pub remaining_percent: Option<f64>,
    pub limit: Option<String>,
    pub remaining: Option<String>,
    /// Unix seconds fit in u32 for the supported desktop horizon; this keeps
    /// the generated TypeScript type as `number` instead of `bigint`.
    pub resets_at: Option<u32>,
    pub reset_after: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/ProviderUsageSnapshot.ts")]
pub struct ProviderUsageSnapshot {
    #[serde(default)]
    pub provider_id: String,
    pub source: String,
    pub plan: Option<String>,
    pub windows: Vec<ProviderUsageWindow>,
    pub credits_balance: Option<String>,
    pub credits_unlimited: bool,
    pub detail: String,
    pub fetched_at: u32,
}

fn now_epoch() -> u32 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .try_into()
        .unwrap_or(u32::MAX)
}

pub async fn usage(app: &AppHandle, provider_id: &str) -> Result<ProviderUsageSnapshot, String> {
    if provider_id == "__codex_cli__" {
        let mut snapshot = usage_codex_cli().await?;
        snapshot.provider_id = provider_id.into();
        return Ok(snapshot);
    }
    if provider_id == "__claude_cli__" {
        let mut snapshot = usage_claude_cli().await?;
        snapshot.provider_id = provider_id.into();
        return Ok(snapshot);
    }
    let file = load_file(app)?;
    let provider = file
        .providers
        .iter()
        .find(|provider| provider.id == provider_id)
        .ok_or_else(|| format!("unknown provider {provider_id}"))?
        .clone();

    let mut snapshot = match provider.kind {
        ProviderKind::CodexLogin => usage_codex_cli().await?,
        ProviderKind::ClaudeSubscription => usage_claude_cli().await?,
        ProviderKind::OpenaiKey | ProviderKind::CustomOpenai | ProviderKind::AnthropicKey => {
            usage_api(app, &provider).await?
        }
    };
    snapshot.provider_id = provider.id;
    Ok(snapshot)
}

async fn usage_codex_cli() -> Result<ProviderUsageSnapshot, String> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let bridge = root.join("scripts/harness-bridge.mjs");
    let output = tokio::time::timeout(
        Duration::from_secs(45),
        Command::new("node")
            .arg(bridge)
            .arg("--usage=1")
            .arg("--protocol=codex-app-server")
            .arg("--command=codex")
            .arg("--args=[]")
            .current_dir(&root)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "Codex usage query timed out".to_string())?
    .map_err(|err| format!("start Codex usage query: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "Codex usage query failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|err| format!("parse Codex usage response: {err}"))
}

async fn usage_claude_cli() -> Result<ProviderUsageSnapshot, String> {
    let output = tokio::time::timeout(
        Duration::from_secs(45),
        Command::new("claude")
            .args(["-p", "/usage", "--output-format", "json"])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "Claude usage query timed out".to_string())?
    .map_err(|err| format!("start Claude usage query: {err}"))?;
    if !output.status.success() {
        return Err(format!(
            "Claude usage query failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let payload: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|err| format!("parse Claude usage response: {err}"))?;
    let result = payload
        .get("result")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let windows = result
        .lines()
        .filter_map(parse_claude_usage_line)
        .collect::<Vec<_>>();
    Ok(ProviderUsageSnapshot {
        provider_id: String::new(),
        source: "claude-cli".into(),
        plan: None,
        windows,
        credits_balance: None,
        credits_unlimited: false,
        detail: "Read from Claude Code /usage using the active CLI subscription.".into(),
        fetched_at: now_epoch(),
    })
}

fn parse_claude_usage_line(line: &str) -> Option<ProviderUsageWindow> {
    let (label, value) = line.trim().split_once(':')?;
    let (used, tail) = value.split_once("% used")?;
    let used_percent = used.split_whitespace().last()?.trim().parse::<f64>().ok()?;
    let reset_after = tail
        .split_once("resets")
        .map(|(_, reset)| reset.trim().trim_start_matches('·').trim().to_string())
        .filter(|value| !value.is_empty());
    Some(ProviderUsageWindow {
        label: label.trim().to_string(),
        used_percent: Some(used_percent),
        remaining_percent: Some((100.0 - used_percent).max(0.0)),
        limit: None,
        remaining: None,
        resets_at: None,
        reset_after,
    })
}

async fn usage_api(
    app: &AppHandle,
    provider: &ProviderRecord,
) -> Result<ProviderUsageSnapshot, String> {
    let secret = vault::read_secret(app, &provider.id)?
        .ok_or_else(|| "provider secret missing".to_string())?;
    let base = provider
        .base_url
        .as_deref()
        .unwrap_or(match provider.kind {
            ProviderKind::AnthropicKey => "https://api.anthropic.com/v1",
            _ => "https://api.openai.com/v1",
        })
        .trim_end_matches('/');
    let client = reqwest::Client::new();
    let mut request = client.get(format!("{base}/models"));
    request = match provider.kind {
        ProviderKind::AnthropicKey => request
            .header("x-api-key", &secret)
            .header("anthropic-version", "2023-06-01"),
        _ => request.bearer_auth(&secret),
    };
    let response = request
        .send()
        .await
        .map_err(|err| format!("usage probe failed: {err}"))?;
    let status = response.status();
    let headers = response.headers().clone();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "usage probe HTTP {}: {}",
            status.as_u16(),
            body.chars().take(240).collect::<String>()
        ));
    }

    let mut windows = Vec::new();
    match provider.kind {
        ProviderKind::AnthropicKey => {
            push_header_window(
                &mut windows,
                &headers,
                "Requests",
                "anthropic-ratelimit-requests",
            );
            push_header_window(
                &mut windows,
                &headers,
                "Tokens",
                "anthropic-ratelimit-tokens",
            );
            push_header_window(
                &mut windows,
                &headers,
                "Input tokens",
                "anthropic-ratelimit-input-tokens",
            );
            push_header_window(
                &mut windows,
                &headers,
                "Output tokens",
                "anthropic-ratelimit-output-tokens",
            );
        }
        _ => {
            push_header_window(&mut windows, &headers, "Requests", "x-ratelimit");
            push_openai_window(&mut windows, &headers, "Requests", "requests");
            push_openai_window(&mut windows, &headers, "Tokens", "tokens");
        }
    }
    windows.dedup_by(|left, right| left.label == right.label);
    let detail = if windows.is_empty() {
        "The API endpoint accepted the key but did not expose remaining quota headers on GET /models. Billing balance is not part of the standard model API.".into()
    } else {
        "Rate-limit remaining values returned by the API endpoint. Billing balance may be managed separately by the provider.".into()
    };
    Ok(ProviderUsageSnapshot {
        provider_id: String::new(),
        source: "api-rate-limit-headers".into(),
        plan: None,
        windows,
        credits_balance: None,
        credits_unlimited: false,
        detail,
        fetched_at: now_epoch(),
    })
}

fn header(headers: &reqwest::header::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

fn make_header_window(
    label: &str,
    limit: Option<String>,
    remaining: Option<String>,
    reset_after: Option<String>,
) -> Option<ProviderUsageWindow> {
    if limit.is_none() && remaining.is_none() && reset_after.is_none() {
        return None;
    }
    let limit_number = limit.as_deref().and_then(|value| value.parse::<f64>().ok());
    let remaining_number = remaining
        .as_deref()
        .and_then(|value| value.parse::<f64>().ok());
    let remaining_percent = limit_number
        .zip(remaining_number)
        .filter(|(total, _)| *total > 0.0)
        .map(|(total, left)| (left / total * 100.0).clamp(0.0, 100.0));
    Some(ProviderUsageWindow {
        label: label.into(),
        used_percent: remaining_percent.map(|value| 100.0 - value),
        remaining_percent,
        limit,
        remaining,
        resets_at: None,
        reset_after,
    })
}

fn push_openai_window(
    windows: &mut Vec<ProviderUsageWindow>,
    headers: &reqwest::header::HeaderMap,
    label: &str,
    unit: &str,
) {
    if let Some(window) = make_header_window(
        label,
        header(headers, &format!("x-ratelimit-limit-{unit}")),
        header(headers, &format!("x-ratelimit-remaining-{unit}")),
        header(headers, &format!("x-ratelimit-reset-{unit}")),
    ) {
        windows.push(window);
    }
}

fn push_header_window(
    windows: &mut Vec<ProviderUsageWindow>,
    headers: &reqwest::header::HeaderMap,
    label: &str,
    prefix: &str,
) {
    if let Some(window) = make_header_window(
        label,
        header(headers, &format!("{prefix}-limit")),
        header(headers, &format!("{prefix}-remaining")),
        header(headers, &format!("{prefix}-reset")),
    ) {
        windows.push(window);
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_claude_subscription_windows() {
        let window = parse_claude_usage_line(
            "Current week (all models): 13% used · resets Jul 25, 11pm (America/Los_Angeles)",
        )
        .expect("usage row");
        assert_eq!(window.label, "Current week (all models)");
        assert_eq!(window.used_percent, Some(13.0));
        assert_eq!(window.remaining_percent, Some(87.0));
        assert_eq!(
            window.reset_after.as_deref(),
            Some("Jul 25, 11pm (America/Los_Angeles)")
        );
    }

    #[test]
    fn calculates_api_header_remaining_percentage() {
        let window = make_header_window(
            "Tokens",
            Some("1000".into()),
            Some("625".into()),
            Some("2s".into()),
        )
        .expect("header row");
        assert_eq!(window.remaining_percent, Some(62.5));
        assert_eq!(window.used_percent, Some(37.5));
        assert_eq!(window.reset_after.as_deref(), Some("2s"));
    }
}
