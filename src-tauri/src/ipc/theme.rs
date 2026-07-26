use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

const MAX_THEME_BYTES: u64 = 2 * 1024 * 1024;
const MAX_THEME_DEPTH: usize = 8;
const MAX_COLORS: usize = 512;
const MAX_TOKEN_RULES: usize = 4096;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/ThemeColorSetting.ts")]
pub struct ThemeColorSetting {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/ThemeTokenSetting.ts")]
pub struct ThemeTokenSetting {
    pub scopes: Vec<String>,
    pub foreground: Option<String>,
    pub background: Option<String>,
    pub font_style: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/ImportedTheme.ts")]
pub struct ImportedTheme {
    pub name: String,
    pub base: String,
    pub source_path: String,
    pub colors: Vec<ThemeColorSetting>,
    pub token_colors: Vec<ThemeTokenSetting>,
}

impl ImportedTheme {
    pub fn sanitized(mut self) -> Option<Self> {
        self.name = bounded(&self.name, 160)?;
        self.base = match self.base.as_str() {
            "light" => "light".into(),
            "dark" => "dark".into(),
            _ => return None,
        };
        self.source_path = bounded(&self.source_path, 4096)?;
        self.colors = self
            .colors
            .into_iter()
            .filter_map(|entry| {
                Some(ThemeColorSetting {
                    key: bounded(&entry.key, 160)?,
                    value: valid_color(&entry.value)?.to_owned(),
                })
            })
            .take(MAX_COLORS)
            .collect();
        self.token_colors = self
            .token_colors
            .into_iter()
            .filter_map(|entry| {
                let scopes = entry
                    .scopes
                    .into_iter()
                    .filter_map(|scope| bounded(&scope, 240))
                    .take(64)
                    .collect::<Vec<_>>();
                if scopes.is_empty() {
                    return None;
                }
                Some(ThemeTokenSetting {
                    scopes,
                    foreground: entry
                        .foreground
                        .as_deref()
                        .and_then(valid_color)
                        .map(str::to_owned),
                    background: entry
                        .background
                        .as_deref()
                        .and_then(valid_color)
                        .map(str::to_owned),
                    font_style: entry
                        .font_style
                        .as_deref()
                        .and_then(|value| bounded(value, 80)),
                })
            })
            .take(MAX_TOKEN_RULES)
            .collect();
        Some(self)
    }
}

#[derive(Default)]
struct ThemeDocument {
    name: Option<String>,
    base: Option<String>,
    colors: HashMap<String, String>,
    token_colors: Vec<ThemeTokenSetting>,
}

#[tauri::command]
pub async fn theme_import_vscode(path: String) -> Result<ImportedTheme, String> {
    tauri::async_runtime::spawn_blocking(move || import_theme(Path::new(&path)))
        .await
        .map_err(|err| format!("theme import task failed: {err}"))?
}

fn import_theme(path: &Path) -> Result<ImportedTheme, String> {
    let path = path
        .canonicalize()
        .map_err(|err| format!("failed to resolve theme {}: {err}", path.display()))?;
    let mut seen = HashSet::new();
    let document = load_theme(&path, 0, &mut seen)?;
    let mut colors = document
        .colors
        .into_iter()
        .map(|(key, value)| ThemeColorSetting { key, value })
        .collect::<Vec<_>>();
    colors.sort_by(|left, right| left.key.cmp(&right.key));
    ImportedTheme {
        name: document.name.unwrap_or_else(|| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("Imported theme")
                .to_owned()
        }),
        base: document
            .base
            .unwrap_or_else(|| infer_base(&colors).to_owned()),
        source_path: path.to_string_lossy().into_owned(),
        colors,
        token_colors: document.token_colors,
    }
    .sanitized()
    .ok_or_else(|| "theme did not contain a valid name/base".to_string())
}

fn load_theme(
    path: &Path,
    depth: usize,
    seen: &mut HashSet<PathBuf>,
) -> Result<ThemeDocument, String> {
    if depth >= MAX_THEME_DEPTH {
        return Err("theme include depth exceeds 8".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|err| format!("failed to resolve theme include {}: {err}", path.display()))?;
    if !seen.insert(canonical.clone()) {
        return Err(format!("circular theme include: {}", canonical.display()));
    }
    let metadata = fs::metadata(&canonical)
        .map_err(|err| format!("failed to stat theme {}: {err}", canonical.display()))?;
    if metadata.len() > MAX_THEME_BYTES {
        return Err(format!("theme exceeds 2 MiB: {}", canonical.display()));
    }
    let source = fs::read_to_string(&canonical).map_err(|err| {
        format!(
            "failed to read theme {} as UTF-8: {err}",
            canonical.display()
        )
    })?;
    let json = remove_trailing_commas(&strip_json_comments(&source));
    let value = serde_json::from_str::<Value>(&json)
        .map_err(|err| format!("invalid VS Code theme {}: {err}", canonical.display()))?;
    let object = value
        .as_object()
        .ok_or_else(|| "VS Code theme root must be an object".to_string())?;

    let mut document = if let Some(include) = object.get("include").and_then(Value::as_str) {
        let include_path = canonical
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join(include);
        load_theme(&include_path, depth + 1, seen)?
    } else {
        ThemeDocument::default()
    };
    if let Some(name) = object.get("name").and_then(Value::as_str) {
        document.name = Some(name.to_owned());
    }
    if let Some(kind) = object.get("type").and_then(Value::as_str) {
        document.base = match kind {
            "light" | "hcLight" => Some("light".into()),
            "dark" | "hc" => Some("dark".into()),
            _ => document.base,
        };
    }
    if let Some(colors) = object.get("colors").and_then(Value::as_object) {
        for (key, value) in colors {
            let Some(value) = value.as_str().and_then(valid_color) else {
                continue;
            };
            document.colors.insert(key.clone(), value.to_owned());
        }
    }
    if let Some(rules) = object.get("tokenColors").and_then(Value::as_array) {
        document
            .token_colors
            .extend(rules.iter().filter_map(parse_token_rule));
    }
    seen.remove(&canonical);
    Ok(document)
}

fn parse_token_rule(value: &Value) -> Option<ThemeTokenSetting> {
    let object = value.as_object()?;
    let scopes = match object.get("scope") {
        Some(Value::String(scope)) => scope
            .split(',')
            .map(str::trim)
            .filter(|scope| !scope.is_empty())
            .map(str::to_owned)
            .collect(),
        Some(Value::Array(scopes)) => scopes
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|scope| !scope.is_empty())
            .map(str::to_owned)
            .collect(),
        _ => Vec::new(),
    };
    let settings = object.get("settings")?.as_object()?;
    Some(ThemeTokenSetting {
        scopes,
        foreground: settings
            .get("foreground")
            .and_then(Value::as_str)
            .and_then(valid_color)
            .map(str::to_owned),
        background: settings
            .get("background")
            .and_then(Value::as_str)
            .and_then(valid_color)
            .map(str::to_owned),
        font_style: settings
            .get("fontStyle")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

fn bounded(value: &str, max: usize) -> Option<String> {
    let value = value.trim();
    (!value.is_empty() && value.len() <= max).then(|| value.to_owned())
}

fn valid_color(value: &str) -> Option<&str> {
    let value = value.trim();
    let hex = value.strip_prefix('#')?;
    matches!(hex.len(), 3 | 4 | 6 | 8)
        .then(|| hex.chars().all(|char| char.is_ascii_hexdigit()))
        .filter(|valid| *valid)
        .map(|_| value)
}

fn infer_base(colors: &[ThemeColorSetting]) -> &'static str {
    let Some(background) = colors
        .iter()
        .find(|entry| entry.key == "editor.background")
        .map(|entry| entry.value.as_str())
    else {
        return "dark";
    };
    let hex = background.trim_start_matches('#');
    if hex.len() < 6 {
        return "dark";
    }
    let component = |range: std::ops::Range<usize>| {
        u8::from_str_radix(&hex[range], 16).unwrap_or_default() as f32
    };
    let luminance = 0.2126 * component(0..2) + 0.7152 * component(2..4) + 0.0722 * component(4..6);
    if luminance >= 140.0 {
        "light"
    } else {
        "dark"
    }
}

fn strip_json_comments(source: &str) -> String {
    let chars = source.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(source.len());
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;
    while index < chars.len() {
        let char = chars[index];
        if in_string {
            output.push(char);
            if escaped {
                escaped = false;
            } else if char == '\\' {
                escaped = true;
            } else if char == '"' {
                in_string = false;
            }
            index += 1;
            continue;
        }
        if char == '"' {
            in_string = true;
            output.push(char);
            index += 1;
            continue;
        }
        if char == '/' && chars.get(index + 1) == Some(&'/') {
            index += 2;
            while index < chars.len() && chars[index] != '\n' {
                output.push(' ');
                index += 1;
            }
            continue;
        }
        if char == '/' && chars.get(index + 1) == Some(&'*') {
            index += 2;
            while index + 1 < chars.len() && !(chars[index] == '*' && chars[index + 1] == '/') {
                output.push(if chars[index] == '\n' { '\n' } else { ' ' });
                index += 1;
            }
            index = (index + 2).min(chars.len());
            continue;
        }
        output.push(char);
        index += 1;
    }
    output
}

fn remove_trailing_commas(source: &str) -> String {
    let chars = source.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(source.len());
    let mut in_string = false;
    let mut escaped = false;
    for (index, char) in chars.iter().copied().enumerate() {
        if in_string {
            output.push(char);
            if escaped {
                escaped = false;
            } else if char == '\\' {
                escaped = true;
            } else if char == '"' {
                in_string = false;
            }
            continue;
        }
        if char == '"' {
            in_string = true;
            output.push(char);
            continue;
        }
        if char == ',' {
            let next = chars[index + 1..]
                .iter()
                .copied()
                .find(|next| !next.is_whitespace());
            if matches!(next, Some('}' | ']')) {
                continue;
            }
        }
        output.push(char);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_jsonc_includes_and_overrides_workbench_colors() {
        let root = tempfile::tempdir().unwrap();
        let base = root.path().join("base.json");
        let child = root.path().join("child.json");
        fs::write(
            &base,
            r##"{
              "name": "Base",
              "type": "dark",
              "colors": { "editor.background": "#101010", },
              "tokenColors": [{ "scope": "comment", "settings": { "foreground": "#777777" } }]
            }"##,
        )
        .unwrap();
        fs::write(
            &child,
            r##"{
              // VS Code JSONC comment
              "name": "Child",
              "include": "./base.json",
              "colors": { "editor.background": "#202020", "editor.foreground": "#eeeeee" },
              "tokenColors": [{ "scope": ["keyword", "storage"], "settings": { "foreground": "#ff00ff", "fontStyle": "bold" } }],
            }"##,
        )
        .unwrap();

        let theme = import_theme(&child).unwrap();
        assert_eq!(theme.name, "Child");
        assert_eq!(theme.base, "dark");
        assert_eq!(theme.colors.len(), 2);
        assert_eq!(theme.token_colors.len(), 2);
        assert!(theme
            .colors
            .iter()
            .any(|entry| entry.key == "editor.background" && entry.value == "#202020"));
    }

    #[test]
    fn rejects_css_injection_colors() {
        assert_eq!(valid_color("#abc"), Some("#abc"));
        assert_eq!(valid_color("#11223344"), Some("#11223344"));
        assert_eq!(valid_color("red"), None);
        assert_eq!(valid_color("var(--danger)"), None);
    }
}
