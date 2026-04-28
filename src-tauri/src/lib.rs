pub mod app_config;
pub mod commands;
pub mod cpa_lifecycle;
pub mod cpa_manager;
pub mod install_detect;
pub mod install_source;
pub mod log_stream;
pub mod panic_log;
pub mod tray;
pub mod util;

use std::sync::OnceLock;

use cpa_manager::SharedCpaState;
use tauri::Manager;

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .connect_timeout(std::time::Duration::from_millis(500))
            .build()
            .expect("reqwest client")
    })
}

/// Liveness probe: prefers the configured health path (default `/health`)
/// but accepts any 2xx/3xx/4xx as "the process is responding". A 5xx or
/// transport error counts as down. The catch-anything-non-5xx rule is
/// deliberate: some CPA versions don't ship `/health` and answer `/` with
/// a 404 from a stricter router; both still mean "process alive".
pub(crate) async fn http_ping(port: u16) -> bool {
    http_health(port, "/health").await
}

pub(crate) async fn http_health(port: u16, path: &str) -> bool {
    let p = if path.starts_with('/') {
        path.to_string()
    } else {
        format!("/{path}")
    };
    let url = format!("http://127.0.0.1:{port}{p}");
    match http_client().get(&url).send().await {
        Ok(resp) => !resp.status().is_server_error(),
        Err(_) => false,
    }
}

use tauri::Emitter;

/// Background loop that monitors CPA after it reaches Running state.
/// On unexpected exits, optionally relaunches with bounded exponential
/// backoff (controlled by `AppSettings.auto_restart`).
pub(crate) fn spawn_health_monitor(app: tauri::AppHandle, state: SharedCpaState, port: u16) {
    // Capture the epoch we're monitoring at spawn time. If anyone else
    // restarts CPA, the epoch changes and we exit silently — the new
    // spawn will register its own monitor.
    let monitored_epoch = state.lock().unwrap().epoch;
    tauri::async_runtime::spawn(async move {
        // Restart attempts within the current 60s sliding window. Reset
        // after we've been Running cleanly for the whole window.
        const MAX_ATTEMPTS: u32 = 3;
        const WINDOW_SECS: u64 = 60;
        let mut attempts: u32 = 0;
        let mut window_started = std::time::Instant::now();

        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

            // Re-read settings each tick so health_path / auto_restart
            // / start_timeout updates take effect without needing a
            // CPA restart. Cheap (one file read per 5s).
            let settings_snapshot = app_config::load_settings(&app);
            let health_path = &settings_snapshot.health_path;

            // Bail out if a newer generation took over — the new spawn
            // owns the next readiness/health cycle.
            {
                let s = state.lock().unwrap();
                if s.epoch != monitored_epoch {
                    log::debug!(
                        "health: epoch advanced ({} → {}); exiting monitor",
                        monitored_epoch,
                        s.epoch
                    );
                    return;
                }
            }

            let current_status = state.lock().unwrap().status.clone();
            match current_status {
                cpa_manager::CpaStatus::Running => {
                    if window_started.elapsed().as_secs() >= WINDOW_SECS && attempts > 0 {
                        log::info!("health: clean window elapsed; resetting restart counter");
                        attempts = 0;
                        window_started = std::time::Instant::now();
                    }
                }
                cpa_manager::CpaStatus::Stopped | cpa_manager::CpaStatus::Idle => return,
                _ => continue,
            }

            let process_alive = cpa_manager::check_process_alive(&state);
            let http_ok = if process_alive {
                http_health(port, health_path).await
            } else {
                false
            };

            if process_alive && http_ok {
                continue;
            }

            // One soft retry: HTTP can blip, the process can be restarting
            // an internal worker. Don't immediately escalate.
            if process_alive && !http_ok {
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                if http_health(port, health_path).await {
                    continue;
                }
            }

            let reason = if !process_alive {
                "CPA process exited unexpectedly".to_string()
            } else {
                "CPA stopped responding to health checks".to_string()
            };

            if settings_snapshot.auto_restart && attempts < MAX_ATTEMPTS {
                attempts += 1;
                let backoff = std::time::Duration::from_secs(2u64.pow(attempts));
                log::warn!(
                    "health: {reason} — auto-restart attempt {attempts}/{MAX_ATTEMPTS} in {}s",
                    backoff.as_secs()
                );
                let _ = app.emit(
                    "cpa:auto-restart",
                    serde_json::json!({
                        "attempt": attempts,
                        "max": MAX_ATTEMPTS,
                        "delaySecs": backoff.as_secs(),
                        "reason": reason,
                    }),
                );
                // Only kill *our* generation. If the user already
                // intervened (manual stop / source switch) the epoch
                // has advanced and kill_cpa_at_epoch is a no-op.
                cpa_manager::kill_cpa_at_epoch(&state, Some(monitored_epoch));
                tokio::time::sleep(backoff).await;

                // After backoff, re-confirm we still own the situation
                // before issuing a new spawn. Otherwise the user (or
                // another monitor) may have taken over.
                {
                    let s = state.lock().unwrap();
                    if s.epoch != monitored_epoch || s.starting || s.process.is_some() {
                        log::info!("health: skipping auto-restart, situation has advanced");
                        return;
                    }
                }
                if let Err(e) = cpa_lifecycle::start(app.clone()).await {
                    log::error!("auto-restart failed to spawn: {e}");
                }
                // The lifecycle::start call spawns its own readiness
                // watcher which will (eventually) flip status back to
                // Running and re-spawn this monitor. Exit this loop so
                // we don't double-monitor.
                return;
            }

            let final_msg = if attempts >= MAX_ATTEMPTS {
                format!("{reason} (gave up after {MAX_ATTEMPTS} restart attempts)")
            } else {
                reason
            };
            {
                let mut s = state.lock().unwrap();
                if s.epoch == monitored_epoch {
                    s.status = cpa_manager::CpaStatus::Error(final_msg.clone());
                }
            }
            let _ = app.emit("cpa:status", &cpa_manager::CpaStatus::Error(final_msg));
            return;
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("cpa-desktop".into()),
                    }),
                ])
                .level(log::LevelFilter::Info)
                // Stamp every line with app version so we can correlate
                // logs with releases when users send us bundles. The
                // CPA binary version is added as a tag inside the
                // lifecycle module where it's known.
                .format(|out, message, record| {
                    out.finish(format_args!(
                        "{} [{}] {} v{} - {}",
                        chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ"),
                        record.level(),
                        record.target(),
                        env!("CARGO_PKG_VERSION"),
                        message
                    ))
                })
                .max_file_size(2 * 1024 * 1024)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .setup(|app| {
            app_config::ensure_dirs(app.handle())?;
            app_config::ensure_config_yaml(app.handle())?;

            let logs = app_config::logs_dir(app.handle());
            let _ = std::fs::create_dir_all(&logs);
            let s_path = app_config::settings_path(app.handle());
            panic_log::install(logs, s_path);

            let mut settings = app_config::load_settings(app.handle());
            // Sync port from config.yaml if present (config.yaml is authoritative)
            if let Ok(yaml_port) = app_config::read_port_from_yaml(app.handle()) {
                if yaml_port != settings.port {
                    settings.port = yaml_port;
                    let _ = app_config::save_settings(app.handle(), &settings);
                }
            }
            let cpa_state = cpa_manager::new_shared_state(settings.port);
            {
                let mut s = cpa_state.lock().unwrap();
                s.auto_start_pending = settings.auto_start;
            }
            app.manage(cpa_state.clone());
            app.manage(log_stream::new_log_buffer());

            tray::setup_tray(app.handle()).ok();

            // Close-to-tray
            if let Some(window) = app.get_webview_window("main") {
                let win = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::cpa::start_cpa,
            commands::cpa::stop_cpa,
            commands::cpa::get_cpa_status,
            commands::cpa::get_cpa_port,
            commands::cpa::check_cpa_running,
            commands::cpa::cpa_binary_exists,
            commands::cpa::get_log_history,
            commands::cpa::clear_logs,
            commands::config::get_settings,
            commands::config::save_settings_cmd,
            commands::config::read_config_yaml,
            commands::config::write_config_yaml,
            commands::config::open_data_dir,
            commands::updater::check_cpa_update,
            commands::updater::download_cpa_update,
            commands::config::get_port_from_yaml,
            commands::config::get_autolaunch_enabled,
            commands::config::set_autolaunch_enabled,
            commands::config::write_config_yaml_port,
            commands::config::list_config_backups,
            commands::config::restore_config_backup,
            commands::config::read_config_field,
            commands::config::write_config_field,
            commands::diag::report_frontend_error,
            commands::diag::open_logs_folder,
            commands::install::get_install_source_info,
            commands::install::detect_install_sources,
            commands::install::validate_install_source,
            commands::install::set_install_source,
            commands::install::upgrade_via_brew,
            commands::install::external_update_instructions,
        ])
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Ready = event {
                let app2 = app.clone();
                util::spawn::supervised(async move {
                    let cpa_state = match app2.try_state::<SharedCpaState>() {
                        Some(s) => s.inner().clone(),
                        None => return,
                    };
                    let pending = {
                        let mut s = cpa_state.lock().unwrap();
                        let pending = s.auto_start_pending;
                        s.auto_start_pending = false;
                        pending
                    };
                    if !pending {
                        return;
                    }
                    let _ = cpa_lifecycle::start(app2).await;
                });
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(cpa_state) = app.try_state::<SharedCpaState>() {
                    cpa_manager::kill_cpa(&cpa_state);
                }
            }
        });
}
