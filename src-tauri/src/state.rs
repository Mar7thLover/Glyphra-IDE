use std::{
    collections::HashMap,
    sync::{atomic::AtomicU64, Mutex},
};

use notify::RecommendedWatcher;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Default)]
pub struct AppState {
    pub recents: Mutex<Vec<RecentProject>>,
    pub watchers: Mutex<HashMap<u64, RecommendedWatcher>>,
    pub next_watcher_id: AtomicU64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/lib/ipc/gen/RecentProject.ts")]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub last_opened_ms: f64,
}
