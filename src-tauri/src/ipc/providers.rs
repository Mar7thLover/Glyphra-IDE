use tauri::AppHandle;

use crate::providers::{self, ProviderRecord, ProviderTestResult, ProviderUpsert};
use crate::vault;

#[tauri::command]
pub fn providers_list(app: AppHandle) -> Result<Vec<ProviderRecord>, String> {
    providers::list(&app)
}

#[tauri::command]
pub fn providers_upsert(
    app: AppHandle,
    provider: ProviderUpsert,
) -> Result<ProviderRecord, String> {
    providers::upsert(&app, provider)
}

#[tauri::command]
pub fn providers_remove(app: AppHandle, id: String) -> Result<(), String> {
    providers::remove(&app, &id)
}

#[tauri::command]
pub fn vault_probe(app: AppHandle, id: String) -> Result<bool, String> {
    vault::probe(&app, &id)
}

#[tauri::command]
pub fn vault_clear(app: AppHandle, id: String) -> Result<(), String> {
    vault::clear(&app, &id)
}

#[tauri::command]
pub async fn provider_test(app: AppHandle, id: String) -> Result<ProviderTestResult, String> {
    providers::test_connection(&app, &id).await
}
