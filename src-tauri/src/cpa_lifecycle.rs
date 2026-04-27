use tauri::{AppHandle, Emitter, Manager};

use crate::cpa_manager::{kill_cpa, spawn_cpa, CpaStatus, SharedCpaState};
use crate::log_stream::{pipe_process_output, LogBuffer};
use crate::{app_config, http_ping, spawn_health_monitor};

pub async fn start(app: AppHandle) -> Result<(), String> {
    let cpa_state = app
        .try_state::<SharedCpaState>()
        .ok_or("cpa state missing")?
        .inner()
        .clone();
    let log_buf = app
        .try_state::<LogBuffer>()
        .ok_or("log buffer missing")?
        .inner()
        .clone();

    let port = cpa_state.lock().unwrap().port;
    let binary = app_config::cpa_binary_path(&app);
    if !binary.exists() {
        let _ = app.emit("cpa:status", &CpaStatus::Idle);
        return Err("CPA binary not present".into());
    }
    if http_ping(port).await {
        cpa_state.lock().unwrap().status = CpaStatus::Running;
        let _ = app.emit("cpa:status", &CpaStatus::Running);
        return Ok(());
    }

    let workdir = app_config::data_dir(&app);
    let output = spawn_cpa(&binary, &workdir, &cpa_state).inspect_err(|e| {
        let _ = app.emit("cpa:status", &CpaStatus::Error(e.clone()));
    })?;
    let _ = app.emit("cpa:status", &CpaStatus::Starting);
    pipe_process_output(app.clone(), log_buf, output.stdout, output.stderr);

    let app2 = app.clone();
    let state2 = cpa_state.clone();
    crate::util::spawn::supervised(async move {
        for _ in 0..30u32 {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            if http_ping(port).await {
                state2.lock().unwrap().status = CpaStatus::Running;
                let _ = app2.emit("cpa:status", &CpaStatus::Running);
                spawn_health_monitor(app2.clone(), state2.clone(), port);
                return;
            }
            if !crate::cpa_manager::check_process_alive(&state2) {
                let msg = "CPA process exited".to_string();
                state2.lock().unwrap().status = CpaStatus::Error(msg.clone());
                let _ = app2.emit("cpa:status", &CpaStatus::Error(msg));
                return;
            }
        }
        let msg = "CPA failed to start within 30s".to_string();
        state2.lock().unwrap().status = CpaStatus::Error(msg.clone());
        let _ = app2.emit("cpa:status", &CpaStatus::Error(msg));
    });
    Ok(())
}

pub fn stop(app: &AppHandle) {
    if let Some(state) = app.try_state::<SharedCpaState>() {
        kill_cpa(&state);
        let _ = app.emit("cpa:status", &CpaStatus::Stopped);
    }
}
