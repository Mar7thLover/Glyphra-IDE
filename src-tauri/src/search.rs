//! Workspace text search via the `grep` + `ignore` crates (ripgrep kernel).

use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex,
    },
    thread,
};

use grep::{
    regex::RegexMatcherBuilder,
    searcher::{sinks::UTF8, BinaryDetection, SearcherBuilder},
};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/SearchHit.ts")]
pub struct SearchHit {
    pub path: String,
    pub line: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/SearchBatch.ts")]
pub struct SearchBatch {
    pub search_id: u32,
    pub hits: Vec<SearchHit>,
    pub done: bool,
}

#[derive(Default)]
pub struct SearchManager {
    next_id: AtomicU32,
    cancels: Mutex<std::collections::HashMap<u32, Arc<AtomicBool>>>,
}

impl SearchManager {
    pub fn start(
        self: &Arc<Self>,
        root: String,
        query: String,
        channel: Channel<SearchBatch>,
    ) -> Result<u32, String> {
        if query.trim().is_empty() {
            return Err("search query is empty".into());
        }
        let root_path = PathBuf::from(&root);
        if !root_path.is_dir() {
            return Err(format!("not a directory: {root}"));
        }

        let search_id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let cancel = Arc::new(AtomicBool::new(false));
        self.cancels
            .lock()
            .map_err(|_| "search lock poisoned")?
            .insert(search_id, Arc::clone(&cancel));

        let manager = Arc::clone(self);
        thread::spawn(move || {
            let _ = run_search(search_id, root_path, query, channel, Arc::clone(&cancel));
            if let Ok(mut map) = manager.cancels.lock() {
                map.remove(&search_id);
            }
        });

        Ok(search_id)
    }

    pub fn cancel(&self, search_id: u32) -> Result<(), String> {
        if let Some(flag) = self
            .cancels
            .lock()
            .map_err(|_| "search lock poisoned")?
            .get(&search_id)
        {
            flag.store(true, Ordering::Relaxed);
        }
        Ok(())
    }
}

fn run_search(
    search_id: u32,
    root: PathBuf,
    query: String,
    channel: Channel<SearchBatch>,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(true)
        .line_terminator(Some(b'\n'))
        .build(&regex_escape_literal(&query))
        .or_else(|_| {
            RegexMatcherBuilder::new()
                .case_insensitive(true)
                .build(&query)
        })
        .map_err(|err| format!("invalid search pattern: {err}"))?;

    let mut searcher = SearcherBuilder::new()
        .binary_detection(BinaryDetection::quit(b'\0'))
        .line_number(true)
        .build();

    let mut batch = Vec::new();
    const BATCH_SIZE: usize = 200;

    for path in searchable_files(&root) {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let path_str = path.to_string_lossy().to_string();

        let sink = UTF8(|line_num, line| {
            if cancel.load(Ordering::Relaxed) {
                return Ok(false);
            }
            batch.push(SearchHit {
                path: path_str.clone(),
                line: line_num as u32,
                text: line.trim_end_matches(['\r', '\n']).to_string(),
            });
            if batch.len() >= BATCH_SIZE {
                let hits = std::mem::take(&mut batch);
                let _ = channel.send(SearchBatch {
                    search_id,
                    hits,
                    done: false,
                });
            }
            Ok(true)
        });

        let _ = searcher.search_path(&matcher, &path, sink);
    }

    if !batch.is_empty() {
        let _ = channel.send(SearchBatch {
            search_id,
            hits: batch,
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

/// Files WalkBuilder yields with gitignore enabled (shared with unit tests).
fn searchable_files(root: &std::path::Path) -> Vec<PathBuf> {
    let walker = WalkBuilder::new(root)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .build();
    let mut files = Vec::new();
    for entry in walker {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            continue;
        }
        files.push(entry.path().to_path_buf());
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn searchable_files_respects_gitignore() {
        let root = std::env::temp_dir().join(format!(
            "glyphra-search-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join(".gitignore"), "secret.txt\nbuild/\n").unwrap();
        fs::write(root.join("src/keep.rs"), "fn keep() {}").unwrap();
        fs::write(root.join("secret.txt"), "SECRET_TOKEN").unwrap();
        fs::create_dir_all(root.join("build")).unwrap();
        fs::write(root.join("build/out.js"), "SECRET_TOKEN").unwrap();

        // ignore crate needs a git repo (or explicit ignore file) — init one.
        let _ = std::process::Command::new("git")
            .args(["init"])
            .current_dir(&root)
            .status();

        let files = searchable_files(&root);
        let names: Vec<String> = files
            .iter()
            .filter_map(|p| p.strip_prefix(&root).ok())
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .collect();

        assert!(
            names.iter().any(|n| n == "src/keep.rs"),
            "expected keep.rs in {names:?}"
        );
        assert!(
            !names.iter().any(|n| n == "secret.txt"),
            "gitignore'd secret.txt should be skipped: {names:?}"
        );
        assert!(
            !names.iter().any(|n| n.starts_with("build/")),
            "gitignore'd build/ should be skipped: {names:?}"
        );

        let _ = fs::remove_dir_all(&root);
    }
}
