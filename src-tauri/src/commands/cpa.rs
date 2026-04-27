use crate::app_config;
use crate::cpa_manager::{self, CpaStatus, SharedCpaState};
use crate::log_stream::{LogBuffer, LogLine};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::time::Duration;

async fn ping(port: u16) -> bool {
    let url = format!("http://localhost:{port}/");
    match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(client) => client.get(&url).send().await.is_ok(),
        Err(_) => false,
    }
}

#[tauri::command]
pub async fn start_cpa(
    app: AppHandle,
    state: State<'_, SharedCpaState>,
) -> Result<(), String> {
    let port = {
        let s = state.lock().unwrap();
        match s.status {
            CpaStatus::Running | CpaStatus::Starting => return Ok(()),
            _ => {}
        }
        s.port
    };

    if ping(port).await {
        let mut s = state.lock().unwrap();
        s.status = CpaStatus::Running;
        let _ = app.emit("cpa:status", &CpaStatus::Running);
        return Ok(());
    }

    let binary = app_config::cpa_binary_path(&app);
    let working_dir = app_config::data_dir(&app);
    let log_buf = app.state::<LogBuffer>().inner().clone();

    let output = cpa_manager::spawn_cpa(&binary, &working_dir, &state)?;
    let _ = app.emit("cpa:status", &CpaStatus::Starting);

    crate::log_stream::pipe_process_output(app.clone(), log_buf, output.stdout, output.stderr);

    let app2 = app.clone();
    let state2 = state.inner().clone();
    tokio::spawn(async move {
        for _ in 0..30u32 {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if ping(port).await {
                let mut s = state2.lock().unwrap();
                s.status = CpaStatus::Running;
                let _ = app2.emit("cpa:status", &CpaStatus::Running);
                return;
            }
            if !cpa_manager::check_process_alive(&state2) {
                let msg = "CPA process exited unexpectedly".to_string();
                {
                    let mut s = state2.lock().unwrap();
                    s.status = CpaStatus::Error(msg.clone());
                }
                let _ = app2.emit("cpa:status", &CpaStatus::Error(msg));
                return;
            }
        }
        let msg = "CPA failed to start within 30s".to_string();
        {
            let mut s = state2.lock().unwrap();
            s.status = CpaStatus::Error(msg.clone());
        }
        let _ = app2.emit("cpa:status", &CpaStatus::Error(msg));
    });

    Ok(())
}

#[tauri::command]
pub fn stop_cpa(app: AppHandle, state: State<'_, SharedCpaState>) -> Result<(), String> {
    cpa_manager::kill_cpa(&state);
    let _ = app.emit("cpa:status", &CpaStatus::Stopped);
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
    Ok(ping(port).await)
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
