pub mod app_config;
pub mod commands;
pub mod cpa_manager;
pub mod log_stream;
pub mod tray;

use cpa_manager::SharedCpaState;
use log_stream::LogBuffer;
use tauri::{Emitter, Manager};

pub(crate) async fn http_ping(port: u16) -> bool {
    let url = format!("http://localhost:{port}/");
    match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
    {
        Ok(client) => client.get(&url).send().await.is_ok(),
        Err(_) => false,
    }
}

/// Background loop that monitors CPA after it reaches Running state.
/// Detects crashes and unexpected exits every 5 seconds.
pub(crate) fn spawn_health_monitor(app: tauri::AppHandle, state: SharedCpaState, port: u16) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

            let current_status = state.lock().unwrap().status.clone();
            // Only monitor while Running
            if current_status != cpa_manager::CpaStatus::Running {
                continue;
            }

            // Check process alive first (cheap)
            if !cpa_manager::check_process_alive(&state) {
                let msg = "CPA process exited unexpectedly".to_string();
                {
                    let mut s = state.lock().unwrap();
                    s.status = cpa_manager::CpaStatus::Error(msg.clone());
                }
                let _ = app.emit("cpa:status", &cpa_manager::CpaStatus::Error(msg));
                continue;
            }

            // Also HTTP-ping to catch hangs
            if !http_ping(port).await {
                // Give it one more chance before flagging
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                if !http_ping(port).await && !cpa_manager::check_process_alive(&state) {
                    let msg = "CPA stopped responding".to_string();
                    {
                        let mut s = state.lock().unwrap();
                        s.status = cpa_manager::CpaStatus::Error(msg.clone());
                    }
                    let _ = app.emit("cpa:status", &cpa_manager::CpaStatus::Error(msg));
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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

            let mut settings = app_config::load_settings(app.handle());
            // Sync port from config.yaml if present (config.yaml is authoritative)
            if let Ok(yaml_port) = app_config::read_port_from_yaml(app.handle()) {
                if yaml_port != settings.port {
                    settings.port = yaml_port;
                    let _ = app_config::save_settings(app.handle(), &settings);
                }
            }
            let cpa_state = cpa_manager::new_shared_state(settings.port);
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

            // Auto-start
            if settings.auto_start {
                let app2 = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;

                    let cpa_state = app2.state::<SharedCpaState>().inner().clone();
                    let log_buf = app2.state::<LogBuffer>().inner().clone();
                    let port = cpa_state.lock().unwrap().port;

                    // Check if already running
                    if http_ping(port).await {
                        let mut s = cpa_state.lock().unwrap();
                        s.status = cpa_manager::CpaStatus::Running;
                        let _ = app2.emit("cpa:status", &cpa_manager::CpaStatus::Running);
                        spawn_health_monitor(app2.clone(), cpa_state.clone(), port);
                        return;
                    }

                    let binary = app_config::cpa_binary_path(&app2);
                    if !binary.exists() {
                        let _ = app2.emit("cpa:status", &cpa_manager::CpaStatus::Idle);
                        return;
                    }

                    let working_dir = app_config::data_dir(&app2);
                    match cpa_manager::spawn_cpa(&binary, &working_dir, &cpa_state) {
                        Ok(output) => {
                            let _ = app2.emit("cpa:status", &cpa_manager::CpaStatus::Starting);
                            log_stream::pipe_process_output(
                                app2.clone(),
                                log_buf,
                                output.stdout,
                                output.stderr,
                            );
                            let app3 = app2.clone();
                            let state2 = cpa_state.clone();
                            tauri::async_runtime::spawn(async move {
                                for _ in 0..30u32 {
                                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                                    if http_ping(port).await {
                                        let mut s = state2.lock().unwrap();
                                        s.status = cpa_manager::CpaStatus::Running;
                                        let _ = app3
                                            .emit("cpa:status", &cpa_manager::CpaStatus::Running);
                                        spawn_health_monitor(app3.clone(), state2.clone(), port);
                                        return;
                                    }
                                    if !cpa_manager::check_process_alive(&state2) {
                                        let msg = "CPA process exited".to_string();
                                        {
                                            let mut s = state2.lock().unwrap();
                                            s.status = cpa_manager::CpaStatus::Error(msg.clone());
                                        }
                                        let _ = app3.emit(
                                            "cpa:status",
                                            &cpa_manager::CpaStatus::Error(msg),
                                        );
                                        return;
                                    }
                                }
                                let msg = "CPA failed to start within 30s".to_string();
                                {
                                    let mut s = state2.lock().unwrap();
                                    s.status = cpa_manager::CpaStatus::Error(msg.clone());
                                }
                                let _ =
                                    app3.emit("cpa:status", &cpa_manager::CpaStatus::Error(msg));
                            });
                        }
                        Err(e) => {
                            let _ = app2.emit("cpa:status", &cpa_manager::CpaStatus::Error(e));
                        }
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
        ])
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|app, event| {
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
