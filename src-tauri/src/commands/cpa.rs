use crate::app_config;
use crate::cpa_manager::{CpaStatus, SharedCpaState};
use crate::log_stream::{LogBuffer, LogLine};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn start_cpa(app: AppHandle) -> Result<(), String> {
    crate::cpa_lifecycle::start(app).await
}

#[tauri::command]
pub async fn stop_cpa(app: AppHandle) -> Result<(), String> {
    crate::cpa_lifecycle::stop(&app);
    Ok(())
}

#[tauri::command]
pub fn get_cpa_status(state: State<'_, SharedCpaState>) -> CpaStatus {
    state.lock().unwrap().status.clone()
}

#[tauri::command]
pub fn get_cpa_port(app: AppHandle) -> u16 {
    app_config::load_settings(&app).port
}

#[tauri::command]
pub async fn check_cpa_running(state: State<'_, SharedCpaState>) -> Result<bool, String> {
    let port = state.lock().unwrap().port;
    Ok(crate::http_ping(port).await)
}

#[tauri::command]
pub fn cpa_binary_exists(app: AppHandle) -> bool {
    app_config::cpa_binary_path(&app).exists()
}

#[tauri::command]
pub fn get_log_history(buf: State<'_, LogBuffer>) -> Vec<LogLine> {
    crate::log_stream::get_all(&buf)
}

#[tauri::command]
pub fn clear_logs(buf: State<'_, LogBuffer>) {
    buf.lock().unwrap().clear();
}
