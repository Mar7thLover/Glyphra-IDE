use std::{
    fs,
    path::{Path, PathBuf},
};

use editorconfig_parser::{
    Charset, EditorConfig, EditorConfigProperties, EditorConfigProperty, EndOfLine, IndentStyle,
    MaxLineLength, QuoteType,
};
use serde::Serialize;
use ts_rs::TS;

const MAX_EDITORCONFIG_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/EditorConfigSettings.ts")]
pub struct EditorConfigSettings {
    pub source_files: Vec<String>,
    pub indent_style: Option<String>,
    pub indent_size: Option<u8>,
    pub tab_width: Option<u8>,
    pub end_of_line: Option<String>,
    pub charset: Option<String>,
    pub trim_trailing_whitespace: Option<bool>,
    pub insert_final_newline: Option<bool>,
    pub max_line_length: Option<u16>,
    pub quote_type: Option<String>,
    pub spelling_language: Option<String>,
}

#[derive(Default)]
struct Resolved {
    properties: EditorConfigProperties,
    spelling_language: Option<String>,
}

struct ConfigFile {
    path: PathBuf,
    base: PathBuf,
    config: EditorConfig,
    spelling: Vec<EditorConfigProperty<String>>,
}

#[tauri::command]
pub async fn editor_config_resolve(path: String) -> Result<EditorConfigSettings, String> {
    tauri::async_runtime::spawn_blocking(move || resolve_path(Path::new(&path)))
        .await
        .map_err(|err| format!("EditorConfig task failed: {err}"))?
}

fn resolve_path(path: &Path) -> Result<EditorConfigSettings, String> {
    let file = path
        .canonicalize()
        .map_err(|err| format!("failed to resolve {}: {err}", path.display()))?;
    if !file.is_file() {
        return Err(format!("{} is not a file", file.display()));
    }
    resolve_existing_file(&file)
}

fn resolve_existing_file(file: &Path) -> Result<EditorConfigSettings, String> {
    let mut configs = Vec::new();
    let mut directory = file
        .parent()
        .ok_or_else(|| "file has no parent directory".to_string())?
        .to_path_buf();

    loop {
        let candidate = directory.join(".editorconfig");
        if candidate.is_file() {
            let metadata = fs::metadata(&candidate)
                .map_err(|err| format!("failed to stat {}: {err}", candidate.display()))?;
            if metadata.len() > MAX_EDITORCONFIG_BYTES {
                return Err(format!(
                    "EditorConfig file exceeds 1 MiB: {}",
                    candidate.display()
                ));
            }
            let source = fs::read_to_string(&candidate)
                .map_err(|err| format!("failed to read {} as UTF-8: {err}", candidate.display()))?;
            let normalized = normalize_source(&source);
            let config = EditorConfig::parse(&normalized);
            let is_root = config.root();
            configs.push(ConfigFile {
                path: candidate,
                base: directory.clone(),
                spelling: spelling_properties(&normalized),
                config,
            });
            if is_root {
                break;
            }
        }
        let Some(parent) = directory.parent() else {
            break;
        };
        directory = parent.to_path_buf();
    }

    configs.reverse();
    let mut resolved = Resolved::default();
    let mut sources = Vec::with_capacity(configs.len());
    for config_file in configs {
        let relative = file
            .strip_prefix(&config_file.base)
            .unwrap_or(file)
            .to_string_lossy()
            .replace('\\', "/");
        let relative = Path::new(&relative);
        for (index, section) in config_file.config.sections().iter().enumerate() {
            if section
                .matcher
                .as_ref()
                .is_some_and(|matcher| matcher.is_match(relative))
            {
                override_properties(&mut resolved.properties, &section.properties);
                if let Some(spelling) = config_file.spelling.get(index) {
                    apply_property(&mut resolved.spelling_language, spelling);
                }
            }
        }
        sources.push(config_file.path.to_string_lossy().into_owned());
    }
    Ok(to_settings(resolved, sources))
}

fn normalize_source(source: &str) -> String {
    source
        .lines()
        .map(|original| {
            let trimmed = original.trim();
            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                let pattern = &trimmed[1..trimmed.len() - 1];
                let pattern = if pattern.starts_with('/') && pattern[1..].contains('/') {
                    &pattern[1..]
                } else {
                    pattern
                };
                return format!("[{pattern}]");
            }
            if trimmed.is_empty() || trimmed.starts_with(['#', ';']) {
                return trimmed.to_owned();
            }
            let Some((key, value)) = trimmed.split_once('=') else {
                return trimmed.to_owned();
            };
            let key = key.trim().to_ascii_lowercase();
            let value = value.trim();
            if key == "indent_size" && value.eq_ignore_ascii_case("tab") {
                // The parser models numeric indent sizes. Zero is an internal
                // sentinel resolved to tab_width below.
                format!("{key} = 0")
            } else {
                format!("{key} = {value}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn spelling_properties(source: &str) -> Vec<EditorConfigProperty<String>> {
    let mut properties = Vec::new();
    for line in source.lines().map(str::trim) {
        if line.starts_with('[') && line.ends_with(']') {
            properties.push(EditorConfigProperty::None);
            continue;
        }
        let Some(current) = properties.last_mut() else {
            continue;
        };
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if !key.trim().eq_ignore_ascii_case("spelling_language") {
            continue;
        }
        let value = value.trim();
        *current = if value.eq_ignore_ascii_case("unset") {
            EditorConfigProperty::Unset
        } else if valid_spelling_language(value) {
            EditorConfigProperty::Value(value.to_owned())
        } else {
            EditorConfigProperty::None
        };
    }
    properties
}

fn valid_spelling_language(value: &str) -> bool {
    let bytes = value.as_bytes();
    (bytes.len() == 2 && bytes.iter().all(u8::is_ascii_alphabetic))
        || (bytes.len() == 5
            && bytes[0..2].iter().all(u8::is_ascii_alphabetic)
            && bytes[2] == b'-'
            && bytes[3..5].iter().all(u8::is_ascii_alphabetic))
}

fn apply_property<T: Clone>(target: &mut Option<T>, property: &EditorConfigProperty<T>) {
    match property {
        EditorConfigProperty::Value(value) => *target = Some(value.clone()),
        EditorConfigProperty::Unset => *target = None,
        EditorConfigProperty::None => {}
    }
}

fn override_properties(target: &mut EditorConfigProperties, source: &EditorConfigProperties) {
    macro_rules! apply {
        ($field:ident) => {
            match &source.$field {
                EditorConfigProperty::Value(value) => {
                    target.$field = EditorConfigProperty::Value(*value)
                }
                EditorConfigProperty::Unset => target.$field = EditorConfigProperty::None,
                EditorConfigProperty::None => {}
            }
        };
    }
    apply!(indent_style);
    apply!(indent_size);
    apply!(tab_width);
    apply!(end_of_line);
    apply!(charset);
    apply!(trim_trailing_whitespace);
    apply!(insert_final_newline);
    apply!(max_line_length);
    apply!(quote_type);
}

fn property_value<T: Copy>(property: EditorConfigProperty<T>) -> Option<T> {
    match property {
        EditorConfigProperty::Value(value) => Some(value),
        EditorConfigProperty::None | EditorConfigProperty::Unset => None,
    }
}

fn bounded_u8(value: Option<usize>) -> Option<u8> {
    value.and_then(|value| (1..=32).contains(&value).then_some(value as u8))
}

fn to_settings(resolved: Resolved, source_files: Vec<String>) -> EditorConfigSettings {
    let properties = resolved.properties;
    let explicit_indent_size = property_value(properties.indent_size);
    let explicit_tab_width = property_value(properties.tab_width);
    let indent_size = if explicit_indent_size == Some(0) {
        explicit_tab_width
    } else {
        explicit_indent_size
    };
    let tab_width = explicit_tab_width.or(indent_size);
    EditorConfigSettings {
        source_files,
        indent_style: property_value(properties.indent_style).map(|value| match value {
            IndentStyle::Tab => "tab".into(),
            IndentStyle::Space => "space".into(),
        }),
        indent_size: bounded_u8(indent_size),
        tab_width: bounded_u8(tab_width),
        end_of_line: property_value(properties.end_of_line).map(|value| match value {
            EndOfLine::Lf => "lf".into(),
            EndOfLine::Cr => "cr".into(),
            EndOfLine::Crlf => "crlf".into(),
        }),
        charset: property_value(properties.charset).map(|value| match value {
            Charset::Latin1 => "latin1".into(),
            Charset::Utf8 => "utf-8".into(),
            Charset::Utf8bom => "utf-8-bom".into(),
            Charset::Utf16be => "utf-16be".into(),
            Charset::Utf16le => "utf-16le".into(),
        }),
        trim_trailing_whitespace: property_value(properties.trim_trailing_whitespace),
        insert_final_newline: property_value(properties.insert_final_newline),
        max_line_length: property_value(properties.max_line_length).and_then(|value| match value {
            MaxLineLength::Number(value) => u16::try_from(value).ok(),
            MaxLineLength::Off => None,
        }),
        quote_type: property_value(properties.quote_type).map(|value| match value {
            QuoteType::Single => "single".into(),
            QuoteType::Double => "double".into(),
            QuoteType::Auto => "auto".into(),
        }),
        spelling_language: resolved.spelling_language,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let file = root.path().join("src").join("nested").join("main.rs");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "fn main() {}\n").unwrap();
        (root, file)
    }

    #[test]
    fn resolves_parent_to_child_with_unset_and_case_insensitive_keys() {
        let (root, file) = fixture();
        fs::write(
            root.path().join(".editorconfig"),
            "ROOT = true\n[*]\nindent_style = space\nindent_size = 4\ncharset = utf-8\ntrim_trailing_whitespace = true\nspelling_language = en-US\n",
        )
        .unwrap();
        fs::write(
            file.parent().unwrap().join(".editorconfig"),
            "[*.rs]\nINDENT_STYLE = tab\nindent_size = tab\ntab_width = 8\ntrim_trailing_whitespace = unset\n",
        )
        .unwrap();

        let settings = resolve_existing_file(&file).unwrap();
        assert_eq!(settings.indent_style.as_deref(), Some("tab"));
        assert_eq!(settings.indent_size, Some(8));
        assert_eq!(settings.tab_width, Some(8));
        assert_eq!(settings.charset.as_deref(), Some("utf-8"));
        assert_eq!(settings.trim_trailing_whitespace, None);
        assert_eq!(settings.spelling_language.as_deref(), Some("en-US"));
        assert_eq!(settings.source_files.len(), 2);
    }

    #[test]
    fn matches_root_relative_patterns_and_all_standard_save_properties() {
        let (root, file) = fixture();
        fs::write(
            root.path().join(".editorconfig"),
            "root=true\n[/src/**/*.rs]\nend_of_line=crlf\ncharset=utf-16le\ninsert_final_newline=false\nmax_line_length=120\nquote_type=single\n",
        )
        .unwrap();

        let settings = resolve_existing_file(&file).unwrap();
        assert_eq!(settings.end_of_line.as_deref(), Some("crlf"));
        assert_eq!(settings.charset.as_deref(), Some("utf-16le"));
        assert_eq!(settings.insert_final_newline, Some(false));
        assert_eq!(settings.max_line_length, Some(120));
        assert_eq!(settings.quote_type.as_deref(), Some("single"));
    }
}
