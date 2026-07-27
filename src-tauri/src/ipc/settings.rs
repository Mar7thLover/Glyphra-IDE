use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use ts_rs::TS;

use super::theme::ImportedTheme;

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/KeybindingSetting.ts")]
pub struct KeybindingSetting {
    pub command: String,
    pub key: String,
    pub when: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[ts(export, export_to = "../../src/lib/ipc/gen/AppSettings.ts")]
pub struct AppSettings {
    pub theme: String,
    /// Achromatic tonal family layered on the scheme: `neutral`, `soft` or
    /// `contrast`.
    pub theme_variant: String,
    pub language: String,
    pub font_size: u16,
    pub tab_size: u8,
    pub word_wrap: bool,
    pub line_numbers: bool,
    pub trim_trailing_whitespace: bool,
    pub insert_final_newline: bool,
    pub format_on_save: bool,
    pub minimap: bool,
    pub breadcrumbs: bool,
    pub sticky_scroll: bool,
    pub bracket_pair_colorization: bool,
    pub indent_guides: bool,
    /// Agent-backed inline completion. Off by default: every suggestion costs a
    /// harness turn.
    pub ghost_text: bool,
    /// Idle time before a ghost-text request is sent, in milliseconds.
    pub ghost_text_delay_ms: u16,
    /// Lazily started language servers for completion, hover, navigation and
    /// diagnostics. Servers are only spawned once a matching file is opened.
    pub language_server: bool,
    /// Language ids the user has switched off individually, even when
    /// `language_server` is on.
    pub language_server_disabled: Vec<String>,
    pub custom_theme: Option<ImportedTheme>,
    pub terminal_webgl: bool,
    pub default_mode: String,
    pub default_backend: String,
    pub default_provider_id: Option<String>,
    pub default_agent_model: Option<String>,
    pub default_reasoning_effort: Option<String>,
    pub default_context_window: Option<u32>,
    pub default_fast_mode: bool,
    pub default_approval_reviewer: String,
    pub open_agent_on_project: bool,
    pub show_selection_agent_button: bool,
    pub keybindings: Vec<KeybindingSetting>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            theme_variant: "neutral".into(),
            language: "system".into(),
            font_size: 13,
            tab_size: 2,
            word_wrap: true,
            line_numbers: true,
            trim_trailing_whitespace: true,
            insert_final_newline: true,
            format_on_save: false,
            minimap: false,
            breadcrumbs: true,
            sticky_scroll: true,
            bracket_pair_colorization: true,
            indent_guides: true,
            ghost_text: false,
            ghost_text_delay_ms: 400,
            language_server: true,
            language_server_disabled: Vec::new(),
            custom_theme: None,
            terminal_webgl: false,
            default_mode: "standard".into(),
            default_backend: "auto".into(),
            default_provider_id: None,
            default_agent_model: None,
            default_reasoning_effort: None,
            default_context_window: None,
            default_fast_mode: false,
            default_approval_reviewer: "user".into(),
            open_agent_on_project: false,
            show_selection_agent_button: false,
            keybindings: default_keybindings(),
        }
    }
}

impl AppSettings {
    fn sanitized(mut self) -> Self {
        let defaults = Self::default();
        if !matches!(self.theme.as_str(), "system" | "light" | "dark") {
            self.theme = defaults.theme;
        }
        if !matches!(self.theme_variant.as_str(), "neutral" | "soft" | "contrast") {
            self.theme_variant = defaults.theme_variant;
        }
        if !matches!(self.language.as_str(), "system" | "en" | "zh-CN") {
            self.language = defaults.language;
        }
        self.font_size = self.font_size.clamp(8, 32);
        self.tab_size = self.tab_size.clamp(1, 8);
        self.ghost_text_delay_ms = self.ghost_text_delay_ms.clamp(150, 5_000);
        if !matches!(
            self.default_mode.as_str(),
            "safe" | "standard" | "unleashed"
        ) {
            self.default_mode = defaults.default_mode;
        }
        if !matches!(
            self.default_reasoning_effort.as_deref(),
            None | Some("low" | "medium" | "high" | "xhigh")
        ) {
            self.default_reasoning_effort = None;
        }
        if !matches!(self.default_approval_reviewer.as_str(), "user" | "auto") {
            self.default_approval_reviewer = defaults.default_approval_reviewer;
        }
        self.default_context_window = self
            .default_context_window
            .map(|value| value.clamp(1_024, 4_000_000));
        self.default_provider_id = bounded_optional(self.default_provider_id, 160);
        self.default_agent_model = bounded_optional(self.default_agent_model, 160);
        self.default_backend = bounded_string(self.default_backend, &defaults.default_backend, 160);
        self.language_server_disabled = sanitize_language_ids(self.language_server_disabled);
        self.custom_theme = self.custom_theme.and_then(ImportedTheme::sanitized);
        self.keybindings = sanitize_keybindings(self.keybindings);
        self
    }
}

fn sanitize_language_ids(values: Vec<String>) -> Vec<String> {
    let mut seen = Vec::new();
    for value in values {
        let value = value.trim().to_ascii_lowercase();
        if value.is_empty()
            || value.len() > 40
            || !value
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '+')
            || seen.contains(&value)
        {
            continue;
        }
        seen.push(value);
        if seen.len() >= 64 {
            break;
        }
    }
    seen
}

fn bounded_optional(value: Option<String>, max: usize) -> Option<String> {
    value.and_then(|value| {
        let value = value.trim();
        (!value.is_empty() && value.len() <= max).then(|| value.to_owned())
    })
}

fn bounded_string(value: String, fallback: &str, max: usize) -> String {
    let value = value.trim();
    if value.is_empty() || value.len() > max {
        fallback.to_owned()
    } else {
        value.to_owned()
    }
}

fn sanitize_keybindings(bindings: Vec<KeybindingSetting>) -> Vec<KeybindingSetting> {
    let bindings = if bindings.is_empty() {
        default_keybindings()
    } else {
        bindings
    };
    let sanitized = bindings
        .into_iter()
        .filter_map(|binding| {
            let command = binding.command.trim();
            let key = binding.key.trim();
            if command.is_empty()
                || command.len() > 120
                || key.is_empty()
                || key.len() > 80
                || binding.when.as_deref().is_some_and(|when| when.len() > 160)
            {
                return None;
            }
            Some(KeybindingSetting {
                command: command.to_owned(),
                key: key.to_owned(),
                when: bounded_optional(binding.when, 160),
            })
        })
        .take(128)
        .collect::<Vec<_>>();
    if sanitized.is_empty() {
        return default_keybindings();
    }
    merge_new_default_commands(sanitized)
}

/// Settings written by an older build have no row for a command added since.
/// Append the default binding for anything missing so a new shortcut is not
/// silently dead for existing installs.
fn merge_new_default_commands(mut bindings: Vec<KeybindingSetting>) -> Vec<KeybindingSetting> {
    for fallback in default_keybindings() {
        if bindings.len() >= 128 {
            break;
        }
        if !bindings
            .iter()
            .any(|binding| binding.command == fallback.command)
        {
            bindings.push(fallback);
        }
    }
    bindings
}

fn default_keybindings() -> Vec<KeybindingSetting> {
    [
        ("workbench.commands", "Ctrl+K", None),
        ("workbench.quickOpen", "Ctrl+P", Some("projectOpen")),
        ("workbench.openFolder", "Ctrl+O", None),
        ("workbench.openFile", "Ctrl+Shift+P", None),
        (
            "editor.goToSymbol",
            "Ctrl+Shift+O",
            Some("editorFocus && projectOpen"),
        ),
        ("workbench.toggleAgent", "Ctrl+J", None),
        ("workbench.settings", "Ctrl+,", None),
        ("workbench.toggleTerminal", "Ctrl+`", Some("projectOpen")),
        ("workbench.search", "Ctrl+Shift+F", Some("projectOpen")),
        ("workbench.review", "Ctrl+Shift+R", Some("projectOpen")),
        ("editor.inlineEdit", "Ctrl+K", Some("editorFocus")),
        ("editor.goToDefinition", "F12", Some("editorFocus")),
        ("editor.findReferences", "Shift+F12", Some("editorFocus")),
        ("editor.rename", "F2", Some("editorFocus")),
        ("editor.save", "Ctrl+S", Some("editorFocus")),
        ("editor.close", "Ctrl+W", Some("editorFocus")),
        ("editor.nextTab", "Ctrl+Tab", Some("editorFocus")),
    ]
    .into_iter()
    .map(|(command, key, when)| KeybindingSetting {
        command: command.into(),
        key: key.into(),
        when: when.map(str::to_owned),
    })
    .collect()
}

#[tauri::command]
pub fn settings_get(app: AppHandle) -> Result<AppSettings, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let data =
        fs::read_to_string(&path).map_err(|err| format!("failed to read settings: {err}"))?;
    Ok(serde_json::from_str::<AppSettings>(&data)
        .unwrap_or_default()
        .sanitized())
}

#[tauri::command]
pub fn settings_set(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    let settings = settings.sanitized();
    let path = settings_path(&app)?;
    let data = serde_json::to_string_pretty(&settings)
        .map_err(|err| format!("failed to serialize settings: {err}"))?;
    let parent = path
        .parent()
        .ok_or_else(|| "settings path has no parent".to_string())?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|err| format!("failed to create settings temp file: {err}"))?;
    std::io::Write::write_all(&mut temporary, data.as_bytes())
        .map_err(|err| format!("failed to write settings: {err}"))?;
    temporary
        .persist(&path)
        .map_err(|err| format!("failed to replace settings: {}", err.error))?;
    app.emit("settings-changed", settings)
        .map_err(|err| format!("failed to broadcast settings: {err}"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("failed to resolve app config dir: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("failed to create config dir: {err}"))?;
    Ok(dir.join("settings.json"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_two_field_settings_gain_safe_defaults() {
        let settings: AppSettings =
            serde_json::from_str(r#"{"theme":"dark","language":"en"}"#).unwrap();
        assert_eq!(settings.font_size, 13);
        assert_eq!(settings.keybindings, default_keybindings());
    }

    #[test]
    fn invalid_settings_are_bounded() {
        let settings = AppSettings {
            theme: "neon".into(),
            language: "xx".into(),
            font_size: u16::MAX,
            tab_size: 0,
            default_context_window: Some(u32::MAX),
            keybindings: vec![KeybindingSetting {
                command: String::new(),
                key: "Ctrl+Q".into(),
                when: None,
            }],
            ..AppSettings::default()
        }
        .sanitized();
        assert_eq!(settings.theme, "system");
        assert_eq!(settings.language, "system");
        assert_eq!(settings.font_size, 32);
        assert_eq!(settings.tab_size, 1);
        assert_eq!(settings.default_context_window, Some(4_000_000));
        assert_eq!(settings.keybindings, default_keybindings());
    }

    #[test]
    fn ghost_text_defaults_off_and_the_delay_is_bounded() {
        let defaults = AppSettings::default();
        assert!(!defaults.ghost_text);
        assert!(!defaults.show_selection_agent_button);
        assert_eq!(defaults.ghost_text_delay_ms, 400);

        let too_fast = AppSettings {
            ghost_text_delay_ms: 0,
            ..AppSettings::default()
        }
        .sanitized();
        assert_eq!(too_fast.ghost_text_delay_ms, 150);

        let too_slow = AppSettings {
            ghost_text_delay_ms: u16::MAX,
            ..AppSettings::default()
        }
        .sanitized();
        assert_eq!(too_slow.ghost_text_delay_ms, 5_000);
    }

    #[test]
    fn settings_written_before_inline_edit_gain_its_binding() {
        let absent: AppSettings =
            serde_json::from_str(r#"{"theme":"dark","language":"en"}"#).unwrap();
        assert!(absent
            .keybindings
            .iter()
            .any(|binding| binding.command == "editor.inlineEdit"));

        // A stored list from an older build keeps its customizations and gains
        // only the commands it has never seen.
        let stored = AppSettings {
            keybindings: vec![KeybindingSetting {
                command: "workbench.commands".into(),
                key: "Ctrl+Shift+K".into(),
                when: None,
            }],
            ..AppSettings::default()
        }
        .sanitized();
        let palette = stored
            .keybindings
            .iter()
            .find(|binding| binding.command == "workbench.commands")
            .expect("palette binding is preserved");
        assert_eq!(palette.key, "Ctrl+Shift+K");
        let inline = stored
            .keybindings
            .iter()
            .find(|binding| binding.command == "editor.inlineEdit")
            .expect("inline edit binding is appended");
        assert_eq!(inline.key, "Ctrl+K");
        assert_eq!(inline.when.as_deref(), Some("editorFocus"));
    }
}
