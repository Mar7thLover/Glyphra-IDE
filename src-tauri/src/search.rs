//! Workspace text search via the `grep` + `ignore` crates (ripgrep kernel).

use std::{
    io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
    thread,
};

use grep::{
    matcher::{Captures, Matcher},
    regex::{RegexCaptures, RegexMatcher, RegexMatcherBuilder},
    searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch},
};
use ignore::overrides::OverrideBuilder;
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use ts_rs::TS;

/// Explicit search options. `regex` is a deliberate choice: when false the
/// query is matched as an escaped literal (no silent regex fallback).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/SearchOptions.ts")]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
    /// Glob patterns (relative to each root) that narrow the search. Empty = all files.
    pub include: Vec<String>,
    /// Glob patterns (relative to each root) that are excluded. Wins over include.
    pub exclude: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/SearchHit.ts")]
pub struct SearchHit {
    pub path: String,
    /// The workspace root this hit belongs to (for multi-root workspaces).
    pub root: String,
    pub line: u32,
    pub text: String,
    /// Byte offsets (start, end) of each match within `text`.
    pub ranges: Vec<(u32, u32)>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/SearchBatch.ts")]
pub struct SearchBatch {
    pub search_id: u32,
    pub hits: Vec<SearchHit>,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/ReplaceSummary.ts")]
pub struct ReplaceSummary {
    pub files_changed: u32,
    pub replacements: u32,
    /// Bounded list of `path: reason` failures.
    pub failed: Vec<String>,
}

#[derive(Default)]
pub struct SearchManager {
    next_id: AtomicU32,
    cancels: Mutex<std::collections::HashMap<(String, u32), Arc<AtomicBool>>>,
}

const MAX_HITS: usize = 20_000;
const REPLACE_MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const REPLACE_MAX_FILES: usize = 10_000;
const MAX_FAILED_REPORTS: usize = 20;
/// Files above this are skipped: a minified bundle is a single multi-megabyte
/// line, and one such line would be copied into a hit verbatim.
const MAX_SEARCH_FILE_BYTES: u64 = 4 * 1024 * 1024;
/// Characters kept per result line. Long lines are windowed, not sent whole.
const MAX_LINE_CHARS: usize = 1_000;
/// Highlight ranges kept per result line — each one becomes a DOM node.
const MAX_RANGES_PER_LINE: usize = 100;
/// Directories never worth searching, pruned even when `.gitignore` does not
/// apply (a plain folder that is not a git repo).
const PRUNED_DIRS: [&str; 5] = [".git", "node_modules", "target", "dist", ".vite"];

impl SearchManager {
    pub fn live_count(&self) -> Result<usize, String> {
        Ok(self
            .cancels
            .lock()
            .map_err(|_| "search lock poisoned")?
            .len())
    }

    pub fn start(
        self: &Arc<Self>,
        window_label: &str,
        roots: Vec<String>,
        query: String,
        options: SearchOptions,
        channel: Channel<SearchBatch>,
    ) -> Result<u32, String> {
        if query.trim().is_empty() {
            return Err("search query is empty".into());
        }
        let root_paths = validate_roots(&roots)?;

        let search_id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let search_key = (window_label.to_owned(), search_id);
        let cancel = Arc::new(AtomicBool::new(false));
        self.cancels
            .lock()
            .map_err(|_| "search lock poisoned")?
            .insert(search_key.clone(), Arc::clone(&cancel));

        let manager = Arc::clone(self);
        let finished_key = search_key;
        thread::spawn(move || {
            let _ = run_search(
                search_id,
                root_paths,
                query,
                options,
                channel,
                Arc::clone(&cancel),
            );
            if let Ok(mut map) = manager.cancels.lock() {
                map.remove(&finished_key);
            }
        });

        Ok(search_id)
    }

    /// Find-and-replace across every searchable file in the roots. Runs on the
    /// caller's thread; the IPC wrapper routes it through `spawn_blocking`.
    pub fn replace(
        &self,
        roots: Vec<String>,
        query: String,
        replacement: String,
        options: SearchOptions,
    ) -> Result<ReplaceSummary, String> {
        if query.trim().is_empty() {
            return Err("replacement query is empty".into());
        }
        let root_paths = validate_roots(&roots)?;
        let matcher = build_matcher(&query, &options)?;

        let mut summary = ReplaceSummary {
            files_changed: 0,
            replacements: 0,
            failed: Vec::new(),
        };
        let mut files_seen = 0;

        'roots: for root in &root_paths {
            for path in searchable_files(root, &options) {
                if files_seen >= REPLACE_MAX_FILES {
                    break 'roots;
                }
                files_seen += 1;
                let Some(result) = replace_in_file(&matcher, &path, &replacement, &options) else {
                    continue;
                };
                match result {
                    Ok(FileReplaceResult::Changed { replacements }) => {
                        summary.replacements =
                            summary.replacements.saturating_add(replacements as u32);
                        summary.files_changed = summary.files_changed.saturating_add(1);
                    }
                    Ok(FileReplaceResult::Unchanged) => {}
                    Err(reason) if summary.failed.len() < MAX_FAILED_REPORTS => {
                        summary.failed.push(format!("{}: {reason}", path.display()));
                    }
                    Err(_) => {}
                }
            }
        }
        Ok(summary)
    }

    pub fn cancel(&self, window_label: &str, search_id: u32) -> Result<(), String> {
        if let Some(flag) = self
            .cancels
            .lock()
            .map_err(|_| "search lock poisoned")?
            .get(&(window_label.to_owned(), search_id))
        {
            flag.store(true, Ordering::Relaxed);
        }
        Ok(())
    }

    pub fn cancel_window(&self, window_label: &str) -> Result<usize, String> {
        let mut cancels = self.cancels.lock().map_err(|_| "search lock poisoned")?;
        let keys = cancels
            .keys()
            .filter(|(label, _)| label == window_label)
            .cloned()
            .collect::<Vec<_>>();
        for key in &keys {
            if let Some(flag) = cancels.remove(key) {
                flag.store(true, Ordering::Relaxed);
            }
        }
        Ok(keys.len())
    }

    pub fn cancel_all(&self) -> Result<usize, String> {
        let mut cancels = self.cancels.lock().map_err(|_| "search lock poisoned")?;
        let count = cancels.len();
        for flag in cancels.values() {
            flag.store(true, Ordering::Relaxed);
        }
        cancels.clear();
        Ok(count)
    }
}

fn validate_roots(roots: &[String]) -> Result<Vec<PathBuf>, String> {
    if roots.is_empty() {
        return Err("search requires at least one root".into());
    }
    let mut paths = Vec::with_capacity(roots.len());
    for root in roots {
        let path = PathBuf::from(root);
        if !path.is_dir() {
            return Err(format!("not a directory: {root}"));
        }
        paths.push(path);
    }
    Ok(paths)
}

fn run_search(
    search_id: u32,
    roots: Vec<PathBuf>,
    query: String,
    options: SearchOptions,
    channel: Channel<SearchBatch>,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let matcher = build_matcher(&query, &options)?;
    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\0'))
        .line_number(true)
        .build();

    let mut batch = Vec::new();
    let mut total = 0_usize;

    'roots: for root in &roots {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let root_str = root.to_string_lossy().to_string();
        for path in searchable_files(root, &options) {
            // The hit cap and a dead channel end the whole search, not just
            // this root — otherwise every remaining root gets walked for
            // nothing.
            if cancel.load(Ordering::Relaxed) || total >= MAX_HITS {
                break 'roots;
            }
            let mut sink = HitCollector {
                matcher: &matcher,
                path: path.to_string_lossy().to_string(),
                root: root_str.clone(),
                search_id,
                channel: &channel,
                cancel: &cancel,
                batch: &mut batch,
                total: &mut total,
                stopped: false,
            };
            let _ = searcher.search_path(&matcher, &path, &mut sink);
            if sink.stopped {
                break 'roots;
            }
        }
    }

    if !batch.is_empty() {
        let _ = channel.send(SearchBatch {
            search_id,
            hits: std::mem::take(&mut batch),
            done: false,
        });
    }
    let _ = channel.send(SearchBatch {
        search_id,
        hits: Vec::new(),
        done: true,
    });
    Ok(())
}

/// Collects matching lines, computes per-line match ranges, and flushes
/// bounded batches over the IPC channel.
struct HitCollector<'a> {
    matcher: &'a RegexMatcher,
    path: String,
    root: String,
    search_id: u32,
    channel: &'a Channel<SearchBatch>,
    cancel: &'a AtomicBool,
    batch: &'a mut Vec<SearchHit>,
    total: &'a mut usize,
    /// Set when a batch flush or the hit cap stopped collection.
    stopped: bool,
}

impl HitCollector<'_> {
    fn stopped(&self) -> bool {
        self.cancel.load(Ordering::Relaxed) || *self.total >= MAX_HITS
    }
}

impl Sink for HitCollector<'_> {
    type Error = io::Error;

    fn matched(&mut self, _searcher: &Searcher, mat: &SinkMatch<'_>) -> Result<bool, io::Error> {
        if self.stopped() {
            return Ok(false);
        }
        let bytes = mat.bytes();
        let mut byte_ranges = Vec::new();
        let _ = self.matcher.try_find_iter(bytes, |m| {
            byte_ranges.push((m.start(), m.end()));
            Ok::<bool, grep::matcher::NoError>(byte_ranges.len() < MAX_RANGES_PER_LINE)
        });
        if byte_ranges.is_empty() {
            return Ok(true);
        }
        let (text, ranges) = render_line(bytes, &byte_ranges);
        if ranges.is_empty() {
            return Ok(true);
        }
        self.batch.push(SearchHit {
            path: self.path.clone(),
            root: self.root.clone(),
            line: mat.line_number().unwrap_or_default() as u32,
            text,
            ranges,
        });
        *self.total += 1;

        if self.batch.len() >= 200 {
            let hits = std::mem::take(self.batch);
            if self
                .channel
                .send(SearchBatch {
                    search_id: self.search_id,
                    hits,
                    done: false,
                })
                .is_err()
            {
                self.stopped = true;
                return Ok(false);
            }
        }
        Ok(true)
    }
}

fn char_floor(text: &str, mut index: usize) -> usize {
    if index >= text.len() {
        return text.len();
    }
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }
    index
}

/// Renders one matching line into a bounded preview: leading indent dropped, a
/// window of at most `MAX_LINE_CHARS` characters around the first match, and
/// highlight ranges rebased onto that window as UTF-16 offsets (what
/// `String.prototype.slice` on the frontend indexes by).
///
/// Without the window a single minified line — routine inside `dist/` or
/// `node_modules/` — is copied verbatim into every hit and turns into one DOM
/// node per match downstream.
fn render_line(bytes: &[u8], byte_ranges: &[(usize, usize)]) -> (String, Vec<(u32, u32)>) {
    let raw = String::from_utf8_lossy(bytes);
    let line = raw.trim_end_matches(['\r', '\n']);
    let leading = line.len() - line.trim_start().len();
    let first = byte_ranges.first().map(|(start, _)| *start).unwrap_or(0);
    // Keep the first match visible even when it sits far past the window width.
    let start = char_floor(line, leading.max(first.saturating_sub(48)));

    let mut text = String::new();
    let mut ranges: Vec<(u32, u32)> = Vec::new();
    let mut u16_pos = 0_u32;
    if start > leading {
        text.push('…');
        u16_pos = 1;
    }
    let mut index = 0_usize;
    let mut open: Option<u32> = None;
    let mut truncated = false;

    for (chars, (relative, ch)) in line[start..].char_indices().enumerate() {
        if chars >= MAX_LINE_CHARS {
            truncated = true;
            break;
        }
        let at = start + relative;
        if let Some(begin) = open {
            if at >= byte_ranges[index].1 {
                ranges.push((begin, u16_pos));
                open = None;
                index += 1;
            }
        }
        if open.is_none() {
            // Skip ranges that ended before the window, then open the one that
            // covers this character. `try_find_iter` yields them sorted and
            // non-overlapping, so a single cursor is enough.
            while index < byte_ranges.len() && byte_ranges[index].1 <= at {
                index += 1;
            }
            if index < byte_ranges.len() && byte_ranges[index].0 <= at {
                open = Some(u16_pos);
            }
        }
        text.push(ch);
        u16_pos += ch.len_utf16() as u32;
    }
    if let Some(begin) = open {
        ranges.push((begin, u16_pos));
    }
    if truncated {
        text.push('…');
    }
    (text, ranges)
}

fn build_matcher(query: &str, options: &SearchOptions) -> Result<RegexMatcher, String> {
    let pattern = if options.regex {
        query.to_string()
    } else {
        regex_escape_literal(query)
    };
    RegexMatcherBuilder::new()
        .case_insensitive(!options.case_sensitive)
        .word(options.whole_word)
        .line_terminator(Some(b'\n'))
        .build(&pattern)
        .map_err(|err| format!("invalid search pattern: {err}"))
}

fn regex_escape_literal(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 2);
    for ch in text.chars() {
        if matches!(
            ch,
            '\\' | '.' | '+' | '*' | '?' | '(' | ')' | '|' | '[' | ']' | '{' | '}' | '^' | '$'
        ) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// Files WalkBuilder yields with gitignore + include/exclude overrides.
fn searchable_files(root: &Path, options: &SearchOptions) -> Vec<PathBuf> {
    let mut overrides = OverrideBuilder::new(root);
    let mut override_ok = true;
    for glob in &options.include {
        if override_ok && overrides.add(glob).is_err() {
            override_ok = false;
        }
    }
    for glob in &options.exclude {
        if override_ok && overrides.add(&format!("!{glob}")).is_err() {
            override_ok = false;
        }
    }
    let overrides = if override_ok {
        overrides.build().ok()
    } else {
        None
    };

    let mut builder = WalkBuilder::new(root);
    builder.hidden(false);
    builder.git_ignore(true);
    builder.git_global(true);
    builder.git_exclude(true);
    // A workspace root is often a plain folder rather than a git repo (dropped
    // onto the window, added to a multi-root workspace, the parent of a single
    // opened file). `.gitignore` is only honoured inside a repo unless we ask
    // for it, and without it `node_modules/` and `dist/` get searched.
    builder.require_git(false);
    if let Some(overrides) = overrides {
        builder.overrides(overrides);
    }
    // Prune build/dependency trees outright, so neither gitignore coverage nor
    // walk cost depends on how the root was opened. The root itself is exempt:
    // a workspace root legitimately named `dist` or `target` must not be
    // pruned away entirely.
    builder.filter_entry(|entry| {
        if entry.file_type().is_some_and(|ft| ft.is_dir()) && entry.depth() > 0 {
            let name = entry.file_name().to_string_lossy();
            return !PRUNED_DIRS.iter().any(|pruned| name == *pruned);
        }
        true
    });
    let walker = builder.build();
    let mut files = Vec::new();
    for entry in walker {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            continue;
        }
        // Oversized files are almost always generated bundles or data dumps;
        // one is enough to blow the result set up on its own.
        if entry
            .metadata()
            .map(|meta| meta.len() > MAX_SEARCH_FILE_BYTES)
            .unwrap_or(false)
        {
            continue;
        }
        files.push(entry.path().to_path_buf());
    }
    files
}

enum FileReplaceResult {
    Changed { replacements: usize },
    Unchanged,
}

/// Applies the replacement to one file (encoding-preserving) and writes it
/// back when anything changed. `None` = skip silently (binary / too large).
fn replace_in_file(
    matcher: &RegexMatcher,
    path: &Path,
    replacement: &str,
    options: &SearchOptions,
) -> Option<Result<FileReplaceResult, String>> {
    let Ok(metadata) = std::fs::metadata(path) else {
        return None;
    };
    if metadata.len() > REPLACE_MAX_FILE_BYTES {
        return None;
    }
    let Ok(bytes) = std::fs::read(path) else {
        return Some(Err("failed to read file".into()));
    };
    // Null bytes mean binary — except inside a BOM'd text encoding such as
    // UTF-16, where ASCII characters legitimately contain 0x00.
    if encoding_rs::Encoding::for_bom(&bytes).is_none() && bytes.contains(&0) {
        return None;
    }
    let decoded = match crate::ipc::project::decode_text(&bytes, None) {
        Ok(decoded) => decoded,
        Err(err) => return Some(Err(err)),
    };
    // A lossy decode cannot round-trip: writing it back would replace the
    // original bytes with U+FFFD. Skip the file, as for binary content.
    if decoded.lossy {
        return None;
    }
    let (text, encoding, bom) = (decoded.content, decoded.encoding, decoded.bom);

    let spans = match collect_spans(matcher, text.as_bytes()) {
        Ok(spans) => spans,
        Err(err) => return Some(Err(err)),
    };
    if spans.is_empty() {
        return Some(Ok(FileReplaceResult::Unchanged));
    }

    let expanded = if options.regex {
        expand_template(matcher, &text, &spans, replacement)
    } else {
        replace_literal(&text, &spans, replacement)
    };
    let encoded = match crate::ipc::project::encode_text(&expanded, Some(&encoding), bom) {
        Ok(encoded) => encoded,
        Err(err) => return Some(Err(err)),
    };
    if encoded == bytes {
        return Some(Ok(FileReplaceResult::Unchanged));
    }
    if let Err(err) = std::fs::write(path, encoded) {
        return Some(Err(format!("failed to write file: {err}")));
    }
    Some(Ok(FileReplaceResult::Changed {
        replacements: spans.len(),
    }))
}

fn collect_spans(matcher: &RegexMatcher, haystack: &[u8]) -> Result<Vec<(usize, usize)>, String> {
    let mut spans = Vec::new();
    let _ = matcher
        .try_find_iter(haystack, |m| {
            spans.push((m.start(), m.end()));
            Ok::<bool, grep::matcher::NoError>(true)
        })
        .map_err(|err| format!("replacement matcher error: {err:?}"))?;
    Ok(spans)
}

fn replace_literal(text: &str, spans: &[(usize, usize)], replacement: &str) -> String {
    let mut out = String::with_capacity(text.len() + replacement.len() * spans.len());
    let mut cursor = 0;
    for (start, end) in spans {
        out.push_str(&text[cursor..*start]);
        out.push_str(replacement);
        cursor = *end;
    }
    out.push_str(&text[cursor..]);
    out
}

/// Expands `$0`–`$9` capture groups and `$$` (literal dollar) against each
/// match. Unknown `$x` sequences stay verbatim.
fn expand_template(
    matcher: &RegexMatcher,
    text: &str,
    spans: &[(usize, usize)],
    template: &str,
) -> String {
    let mut out = String::with_capacity(text.len() + template.len() * spans.len());
    let mut cursor = 0;
    let mut captures = matcher
        .new_captures()
        .expect("matcher captures cannot fail for NoError");
    for (start, end) in spans {
        out.push_str(&text[cursor..*start]);
        let _ = matcher.captures_at(text.as_bytes(), *start, &mut captures);
        out.push_str(&expand_one(&captures, text, template));
        cursor = *end;
    }
    out.push_str(&text[cursor..]);
    out
}

fn expand_one(captures: &RegexCaptures, text: &str, template: &str) -> String {
    let mut out = String::new();
    let bytes = template.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let ch = bytes[index];
        if ch == b'$' && index + 1 < bytes.len() {
            let next = bytes[index + 1];
            match next {
                b'$' => {
                    out.push('$');
                    index += 2;
                    continue;
                }
                b'0'..=b'9' => {
                    let group = (next - b'0') as usize;
                    if let Some(m) = captures.get(group) {
                        out.push_str(&text[m.start()..m.end()]);
                    }
                    index += 2;
                    continue;
                }
                _ => {}
            }
        }
        let ch_len = utf8_len(bytes, index);
        out.push_str(&template[index..index + ch_len]);
        index += ch_len;
    }
    out
}

fn utf8_len(bytes: &[u8], index: usize) -> usize {
    let b = bytes[index];
    if b < 0x80 {
        1
    } else if b >= 0xF0 {
        4
    } else if b >= 0xE0 {
        3
    } else if b >= 0xC0 {
        2
    } else {
        1
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "glyphra-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn searchable_files_respects_gitignore() {
        let root = temp_root("search");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join(".gitignore"), "secret.txt\nbuild/\n").unwrap();
        fs::write(root.join("src/keep.rs"), "fn keep() {}").unwrap();
        fs::write(root.join("secret.txt"), "SECRET_TOKEN").unwrap();
        fs::create_dir_all(root.join("build")).unwrap();
        fs::write(root.join("build/out.js"), "SECRET_TOKEN").unwrap();

        let _ = std::process::Command::new("git")
            .args(["init"])
            .current_dir(&root)
            .status();

        let files = searchable_files(&root, &SearchOptions::default());
        let names: Vec<String> = files
            .iter()
            .filter_map(|p| p.strip_prefix(&root).ok())
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .collect();

        assert!(names.iter().any(|n| n == "src/keep.rs"));
        assert!(!names.iter().any(|n| n == "secret.txt"));
        assert!(!names.iter().any(|n| n.starts_with("build/")));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn include_exclude_overrides_filter_files() {
        let root = temp_root("overrides");
        fs::create_dir_all(root.join("lib")).unwrap();
        fs::write(root.join("main.rs"), "fn main() {}").unwrap();
        fs::write(root.join("lib/util.rs"), "pub fn util() {}").unwrap();
        fs::write(root.join("lib/util.test.rs"), "pub fn test() {}").unwrap();

        let options = SearchOptions {
            include: vec!["*.rs".into()],
            exclude: vec!["**/*.test.rs".into()],
            ..Default::default()
        };
        let files = searchable_files(&root, &options);
        let names: Vec<String> = files
            .iter()
            .filter_map(|p| p.strip_prefix(&root).ok())
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .collect();

        assert!(names.contains(&"main.rs".to_string()), "{names:?}");
        assert!(names.contains(&"lib/util.rs".to_string()), "{names:?}");
        assert!(
            !names.contains(&"lib/util.test.rs".to_string()),
            "{names:?}"
        );

        let _ = fs::remove_dir_all(&root);
    }

    fn ranges_for(matcher: &RegexMatcher, line: &[u8]) -> Vec<(usize, usize)> {
        let mut spans = Vec::new();
        let _ = matcher.try_find_iter(line, |m| {
            spans.push((m.start(), m.end()));
            Ok::<bool, grep::matcher::NoError>(spans.len() < MAX_RANGES_PER_LINE)
        });
        spans
    }

    #[test]
    fn render_line_drops_indent_and_rebases_ranges_as_utf16() {
        let matcher = build_matcher("bar", &SearchOptions::default()).expect("matcher");
        let line = "    let 世界 = bar;\r\n".as_bytes();
        let (text, ranges) = render_line(line, &ranges_for(&matcher, line));

        assert_eq!(text, "let 世界 = bar;");
        let units: Vec<u16> = text.encode_utf16().collect();
        let (start, end) = ranges[0];
        assert_eq!(
            String::from_utf16(&units[start as usize..end as usize]).unwrap(),
            "bar",
        );
    }

    #[test]
    fn render_line_windows_long_lines_and_caps_ranges() {
        // A minified bundle is one line of megabytes: the preview must stay
        // bounded in both text and highlight count.
        let matcher = build_matcher("x", &SearchOptions::default()).expect("matcher");
        let line = "x".repeat(200_000);
        let spans = ranges_for(&matcher, line.as_bytes());
        assert_eq!(spans.len(), MAX_RANGES_PER_LINE);

        let (text, ranges) = render_line(line.as_bytes(), &spans);
        assert!(text.chars().count() <= MAX_LINE_CHARS + 1, "{}", text.len());
        assert!(text.ends_with('…'));
        assert!(ranges.len() <= MAX_RANGES_PER_LINE);
    }

    #[test]
    fn render_line_keeps_a_late_match_inside_the_window() {
        let matcher = build_matcher("needle", &SearchOptions::default()).expect("matcher");
        let line = format!("{}needle tail", "a".repeat(5_000));
        let (text, ranges) = render_line(line.as_bytes(), &ranges_for(&matcher, line.as_bytes()));

        assert!(text.starts_with('…'));
        assert_eq!(ranges.len(), 1);
        let units: Vec<u16> = text.encode_utf16().collect();
        let (start, end) = ranges[0];
        assert_eq!(
            String::from_utf16(&units[start as usize..end as usize]).unwrap(),
            "needle",
        );
    }

    /// End-to-end guard for the payload that reaches the webview: a minified
    /// asset is a single multi-megabyte line, and before it was windowed one
    /// such line produced a hit carrying the whole line plus a highlight range
    /// per match — enough to exhaust memory once rendered.
    #[test]
    fn run_search_keeps_hits_bounded_on_a_minified_line() {
        let root = temp_root("minified");
        fs::write(
            root.join("bundle.min.js"),
            format!("var a={};", "token,".repeat(200_000)),
        )
        .unwrap();
        fs::write(root.join("app.ts"), "    const token = 1;\n").unwrap();

        let hits = Arc::new(Mutex::new(Vec::<SearchHit>::new()));
        let sink = Arc::clone(&hits);
        let channel = tauri::ipc::Channel::new(move |body| {
            let tauri::ipc::InvokeResponseBody::Json(json) = body else {
                return Ok(());
            };
            let batch: serde_json::Value = serde_json::from_str(&json).unwrap();
            let parsed: Vec<SearchHit> = serde_json::from_value(batch["hits"].clone()).unwrap();
            sink.lock().unwrap().extend(parsed);
            Ok(())
        });

        run_search(
            1,
            vec![root.clone()],
            "token".into(),
            SearchOptions::default(),
            channel,
            Arc::new(AtomicBool::new(false)),
        )
        .expect("search");

        let hits = hits.lock().unwrap();
        assert!(!hits.is_empty());
        for hit in hits.iter() {
            assert!(
                hit.text.chars().count() <= MAX_LINE_CHARS + 2,
                "line preview unbounded: {} chars",
                hit.text.chars().count(),
            );
            assert!(
                hit.ranges.len() <= MAX_RANGES_PER_LINE,
                "ranges unbounded: {}",
                hit.ranges.len(),
            );
        }
        // The indented source line keeps its highlight aligned after trimming.
        let source = hits
            .iter()
            .find(|hit| hit.path.ends_with("app.ts"))
            .expect("source hit");
        assert_eq!(source.text, "const token = 1;");
        assert_eq!(source.ranges, vec![(6, 11)]);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn searchable_files_prunes_dependency_trees_without_git() {
        let root = temp_root("prune");
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/app.ts"), "const token = 1;").unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "const token = 1;").unwrap();
        // Oversized generated output is skipped even outside a pruned directory.
        fs::write(
            root.join("bundle.js"),
            "x".repeat(MAX_SEARCH_FILE_BYTES as usize + 1),
        )
        .unwrap();

        let files = searchable_files(&root, &SearchOptions::default());
        let names: Vec<String> = files
            .iter()
            .filter_map(|p| p.strip_prefix(&root).ok())
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .collect();

        assert!(names.contains(&"src/app.ts".to_string()), "{names:?}");
        assert!(
            !names.iter().any(|n| n.starts_with("node_modules/")),
            "{names:?}"
        );
        assert!(!names.contains(&"bundle.js".to_string()), "{names:?}");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn searchable_files_keeps_a_root_named_like_a_pruned_dir() {
        let root = temp_root("prune-root");
        let dist = root.join("dist");
        fs::create_dir_all(&dist).unwrap();
        fs::write(dist.join("main.js"), "const token = 1;").unwrap();

        let files = searchable_files(&dist, &SearchOptions::default());
        let names: Vec<String> = files
            .iter()
            .filter_map(|p| p.strip_prefix(&dist).ok())
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .collect();

        assert!(names.contains(&"main.js".to_string()), "{names:?}");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn matcher_respects_case_word_and_regex_flags() {
        let options = SearchOptions {
            case_sensitive: true,
            whole_word: true,
            ..Default::default()
        };
        let matcher = build_matcher("Foo", &options).expect("matcher");
        assert!(matcher.find(b"a Foo b").is_ok() && matcher.find(b"a Foo b").unwrap().is_some());
        assert!(matcher.find(b"a foo b").unwrap().is_none());
        assert!(matcher.find(b"FooBar").unwrap().is_none());

        let regex = SearchOptions {
            regex: true,
            case_sensitive: true,
            ..Default::default()
        };
        let matcher = build_matcher(r"foo\d+", &regex).expect("regex matcher");
        assert!(matcher.find(b"foo123").unwrap().is_some());
    }

    #[test]
    fn literal_escaping_keeps_regex_chars_verbatim() {
        let options = SearchOptions::default();
        let matcher = build_matcher("a+b", &options).expect("matcher");
        assert!(matcher.find(b"a+b").unwrap().is_some());
        assert!(matcher.find(b"aaab").unwrap().is_none());
    }

    #[test]
    fn replace_rewrites_literal_and_regex_and_preserves_utf8() {
        let root = temp_root("replace");
        let file = root.join("notes.txt");
        fs::write(&file, "Hello World\nhello again\n").unwrap();

        let manager = SearchManager::default();
        let summary = manager
            .replace(
                vec![root.to_string_lossy().to_string()],
                "hello".into(),
                "HEY".into(),
                SearchOptions::default(),
            )
            .expect("replace");
        assert_eq!(summary.files_changed, 1);
        assert_eq!(summary.replacements, 2);
        let content = fs::read_to_string(&file).expect("read");
        assert_eq!(content, "HEY World\nHEY again\n");

        // Case-sensitive literal only rewrites lowercase matches.
        let summary = manager
            .replace(
                vec![root.to_string_lossy().to_string()],
                "HEY".into(),
                "hey".into(),
                SearchOptions {
                    case_sensitive: true,
                    ..Default::default()
                },
            )
            .expect("replace case-sensitive");
        assert_eq!(summary.files_changed, 1);
        assert_eq!(summary.replacements, 2);
        assert_eq!(fs::read_to_string(&file).unwrap(), "hey World\nhey again\n");

        // Regex mode with group expansion.
        let summary = manager
            .replace(
                vec![root.to_string_lossy().to_string()],
                r"(hey)\s+World".into(),
                "$1-$1".into(),
                SearchOptions {
                    regex: true,
                    case_sensitive: true,
                    ..Default::default()
                },
            )
            .expect("replace regex");
        assert_eq!(summary.files_changed, 1);
        let content = fs::read_to_string(&file).expect("read");
        assert_eq!(content, "hey-hey\nhey again\n");

        // Case-insensitive default.
        let summary = manager
            .replace(
                vec![root.to_string_lossy().to_string()],
                "hey".into(),
                "ok".into(),
                SearchOptions::default(),
            )
            .expect("replace case-insensitive");
        assert_eq!(summary.files_changed, 1);
        assert_eq!(summary.replacements, 3);
        assert_eq!(fs::read_to_string(&file).unwrap(), "ok-ok\nok again\n");

        // Whole-word: a bare match must not hit.
        fs::write(&file, "cat catalog\n").unwrap();
        let summary = manager
            .replace(
                vec![root.to_string_lossy().to_string()],
                "cat".into(),
                "dog".into(),
                SearchOptions {
                    whole_word: true,
                    ..Default::default()
                },
            )
            .expect("replace whole word");
        assert_eq!(summary.files_changed, 1);
        assert_eq!(summary.replacements, 1);
        assert_eq!(fs::read_to_string(&file).unwrap(), "dog catalog\n");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn replace_skips_binary_and_reports_utf16_bom_roundtrip() {
        let root = temp_root("replace-binary");
        let binary = root.join("data.bin");
        fs::write(&binary, b"\x00\x01hello\x00").unwrap();
        let text = root.join("text.txt");
        fs::write(&text, "hello\n").unwrap();

        let summary = SearchManager::default()
            .replace(
                vec![root.to_string_lossy().to_string()],
                "hello".into(),
                "bye".into(),
                SearchOptions::default(),
            )
            .expect("replace");
        assert_eq!(summary.files_changed, 1);
        assert_eq!(summary.replacements, 1);
        assert_eq!(fs::read(&binary).unwrap(), b"\x00\x01hello\x00");
        assert_eq!(fs::read_to_string(&text).unwrap(), "bye\n");

        // UTF-16LE with BOM roundtrip.
        let utf16 = root.join("utf16.txt");
        let original =
            crate::ipc::project::encode_text("hello 世界", Some("UTF-16LE"), true).unwrap();
        fs::write(&utf16, &original).unwrap();
        let summary = SearchManager::default()
            .replace(
                vec![root.to_string_lossy().to_string()],
                "hello".into(),
                "HELLO".into(),
                SearchOptions::default(),
            )
            .expect("replace utf16");
        assert_eq!(summary.files_changed, 1);
        let decoded =
            crate::ipc::project::decode_text(&fs::read(&utf16).unwrap(), None).unwrap();
        assert_eq!(decoded.content, "HELLO 世界");
        assert_eq!(decoded.encoding, "UTF-16LE");
        assert!(decoded.bom);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cancel_all_sets_every_flag_and_drains_registry() {
        let manager = SearchManager::default();
        let first = Arc::new(AtomicBool::new(false));
        let second = Arc::new(AtomicBool::new(false));
        manager.cancels.lock().unwrap().extend([
            (("project-a".into(), 1), Arc::clone(&first)),
            (("project-b".into(), 2), Arc::clone(&second)),
        ]);

        assert_eq!(manager.cancel_all().unwrap(), 2);
        assert!(first.load(Ordering::Relaxed));
        assert!(second.load(Ordering::Relaxed));
        assert!(manager.cancels.lock().unwrap().is_empty());
    }

    #[test]
    fn cancel_window_only_drains_matching_searches() {
        let manager = SearchManager::default();
        let first = Arc::new(AtomicBool::new(false));
        let second = Arc::new(AtomicBool::new(false));
        manager.cancels.lock().unwrap().extend([
            (("project-a".into(), 1), Arc::clone(&first)),
            (("project-b".into(), 2), Arc::clone(&second)),
        ]);

        assert_eq!(manager.cancel_window("project-a").unwrap(), 1);
        assert!(first.load(Ordering::Relaxed));
        assert!(!second.load(Ordering::Relaxed));
        assert_eq!(manager.live_count().unwrap(), 1);
    }
}
