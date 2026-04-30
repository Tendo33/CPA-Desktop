use tauri::{AppHandle, Emitter, Manager};

use crate::cpa_manager::{kill_cpa, spawn_cpa, CpaStatus, SharedCpaState};
use crate::log_stream::{pipe_process_output, LogBuffer};
use crate::util::port::is_port_available;
use crate::{app_config, http_health, is_cpa_service, spawn_health_monitor};

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
    // Safety net: managed source may have an older build that skipped
    // bootstrap. ensure_config_yaml is a no-op for external sources and
    // when the file already exists.
    if let Err(e) = app_config::ensure_config_yaml(&app) {
        log::warn!("ensure_config_yaml before start failed: {e}");
    }
    // If something already answers our health probe on the port, assume
    // it's a CPA we should attach to (the original "external CPA"
    // handoff behaviour).
    let settings = app_config::load_settings(&app);
    if is_cpa_service(port, &settings.health_path).await {
        cpa_state.lock().unwrap().status = CpaStatus::Running;
        let _ = app.emit("cpa:status", &CpaStatus::Running);
        return Ok(());
    }

    // Port preflight: some other process is bound but it doesn't speak
    // CPA. Surface that immediately rather than after a 60s startup wait.
    if !is_port_available(port) {
        let msg = format!("port_in_use:{port}");
        cpa_state.lock().unwrap().status = CpaStatus::Error(msg.clone());
        let _ = app.emit("cpa:status", &CpaStatus::Error(msg.clone()));
        return Err(msg);
    }

    let workdir = ensure_working_dir(&app);
    let (output, spawned_epoch) = spawn_cpa(&binary, &workdir, &cpa_state).inspect_err(|e| {
        let _ = app.emit("cpa:status", &CpaStatus::Error(e.clone()));
    })?;
    let _ = app.emit("cpa:status", &CpaStatus::Starting);
    pipe_process_output(
        app.clone(),
        log_buf,
        output.stdout,
        output.stderr,
        port,
        spawned_epoch,
        cpa_state.clone(),
    );

    let timeout_secs = settings.start_timeout_secs.max(5);
    let health_path = settings.health_path.clone();

    let app2 = app.clone();
    let state2 = cpa_state.clone();
    crate::util::spawn::supervised(async move {
        for _ in 0..timeout_secs {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            // If our generation has been superseded (user clicked
            // Restart, auto-restart kicked in, etc.) bail out — the
            // newer spawn has its own readiness watcher.
            {
                let s = state2.lock().unwrap();
                if s.epoch != spawned_epoch {
                    return;
                }
            }
            if http_health(port, &health_path).await {
                let mut s = state2.lock().unwrap();
                if s.epoch != spawned_epoch {
                    return;
                }
                s.status = CpaStatus::Running;
                drop(s);
                let _ = app2.emit("cpa:status", &CpaStatus::Running);
                spawn_health_monitor(app2.clone(), state2.clone(), port);
                return;
            }
            if !crate::cpa_manager::check_process_alive(&state2) {
                let msg = "CPA process exited".to_string();
                let mut s = state2.lock().unwrap();
                if s.epoch == spawned_epoch {
                    s.status = CpaStatus::Error(msg.clone());
                }
                drop(s);
                let _ = app2.emit("cpa:status", &CpaStatus::Error(msg));
                return;
            }
        }
        let msg = format!("CPA failed to start within {timeout_secs}s");
        {
            let mut s = state2.lock().unwrap();
            if s.epoch == spawned_epoch {
                s.status = CpaStatus::Error(msg.clone());
            }
        }
        let _ = app2.emit("cpa:status", &CpaStatus::Error(msg));
    });
    Ok(())
}

/// Resolve the working directory for the CPA child process and make sure
/// it actually exists before we hand it to `Command::current_dir`.
///
/// For Homebrew sources the conventional working dir is
/// `{prefix}/var/cliproxyapi`, which `brew install` does NOT create. If
/// we fail to create it (e.g. permissions), we fall back to the parent
/// of `config.yaml` so spawn doesn't blow up with `ENOENT` on cwd.
fn ensure_working_dir(app: &AppHandle) -> std::path::PathBuf {
    let workdir = app_config::data_dir(app);
    if workdir.is_dir() {
        return workdir;
    }
    if std::fs::create_dir_all(&workdir).is_ok() {
        return workdir;
    }
    log::warn!(
        "working dir {} unavailable; falling back to config parent",
        workdir.display()
    );
    let cfg = app_config::config_yaml_path(app);
    cfg.parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

pub fn stop(app: &AppHandle) {
    if let Some(state) = app.try_state::<SharedCpaState>() {
        kill_cpa(&state);
        let _ = app.emit("cpa:status", &CpaStatus::Stopped);
    }
}
