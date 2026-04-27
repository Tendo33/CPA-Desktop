pub mod app_config;
pub mod commands;
pub mod cpa_lifecycle;
pub mod cpa_manager;
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
            .build()
            .expect("reqwest client")
    })
}

pub(crate) async fn http_ping(port: u16) -> bool {
    let url = format!("http://localhost:{port}/");
    http_client().get(&url).send().await.is_ok()
}

use tauri::Emitter;

/// Background loop that monitors CPA after it reaches Running state.
/// Detects crashes and unexpected exits every 5 seconds.
pub(crate) fn spawn_health_monitor(app: tauri::AppHandle, state: SharedCpaState, port: u16) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

            let current_status = state.lock().unwrap().status.clone();
            match current_status {
                cpa_manager::CpaStatus::Running => {}
                cpa_manager::CpaStatus::Stopped | cpa_manager::CpaStatus::Idle => return,
                _ => continue,
            }

            if !cpa_manager::check_process_alive(&state) {
                let msg = "CPA process exited unexpectedly".to_string();
                {
                    let mut s = state.lock().unwrap();
                    s.status = cpa_manager::CpaStatus::Error(msg.clone());
                }
                let _ = app.emit("cpa:status", &cpa_manager::CpaStatus::Error(msg));
                return;
            }

            if !http_ping(port).await {
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                if !http_ping(port).await && !cpa_manager::check_process_alive(&state) {
                    let msg = "CPA stopped responding".to_string();
                    {
                        let mut s = state.lock().unwrap();
                        s.status = cpa_manager::CpaStatus::Error(msg.clone());
                    }
                    let _ = app.emit("cpa:status", &cpa_manager::CpaStatus::Error(msg));
                    return;
                }
            }
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
            commands::diag::report_frontend_error,
            commands::diag::open_logs_folder,
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
