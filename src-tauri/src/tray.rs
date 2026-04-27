use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Listener, Manager,
};

use crate::cpa_manager::{CpaStatus, SharedCpaState};

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::new("Open Dashboard")
        .id("show")
        .build(app)?;
    let start = MenuItemBuilder::new("Start CPA").id("start").build(app)?;
    let stop = MenuItemBuilder::new("Stop CPA").id("stop").build(app)?;
    let sep1 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let sep2 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::new("Quit CPA Desktop")
        .id("quit")
        .build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&sep1)
        .item(&start)
        .item(&stop)
        .item(&sep2)
        .item(&quit)
        .build()?;

    let app2 = app.clone();
    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("CPA Desktop — Stopped")
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "start" => {
                let app_c = app.clone();
                tauri::async_runtime::spawn(async move {
                    tray_start_cpa(app_c).await;
                });
            }
            "stop" => {
                if let Some(cpa_state) = app.try_state::<SharedCpaState>() {
                    crate::cpa_manager::kill_cpa(&cpa_state);
                    let _ = app.emit("cpa:status", &CpaStatus::Stopped);
                }
            }
            "quit" => {
                if let Some(cpa_state) = app.try_state::<SharedCpaState>() {
                    crate::cpa_manager::kill_cpa(&cpa_state);
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                show_main_window(tray.app_handle());
            }
        })
        .build(&app2)?;

    // Update tray tooltip whenever CPA status changes
    let app3 = app.clone();
    app.listen("cpa:status", move |event| {
        let payload = event.payload();
        // Try to detect status string from JSON payload
        let tooltip = if payload.contains("running") || payload.contains("Running") {
            "CPA Desktop — Running ✓"
        } else if payload.contains("starting") || payload.contains("Starting") {
            "CPA Desktop — Starting…"
        } else if payload.contains("error") || payload.contains("Error") {
            "CPA Desktop — Error"
        } else if payload.contains("idle") || payload.contains("Idle") {
            "CPA Desktop — Not downloaded"
        } else {
            "CPA Desktop — Stopped"
        };
        if let Some(tray) = app3.tray_by_id("") {
            let _ = tray.set_tooltip(Some(tooltip));
        }
    });

    Ok(())
}

/// Start CPA from tray context (mirrors commands::cpa::start_cpa logic).
async fn tray_start_cpa(app: AppHandle) {
    use crate::app_config;

    let cpa_state = match app.try_state::<SharedCpaState>() {
        Some(s) => s.inner().clone(),
        None => return,
    };
    let log_buf = match app.try_state::<crate::log_stream::LogBuffer>() {
        Some(b) => b.inner().clone(),
        None => return,
    };

    let port = cpa_state.lock().unwrap().port;
    let binary = app_config::cpa_binary_path(&app);

    if !binary.exists() {
        let _ = app.emit("cpa:status", &CpaStatus::Idle);
        return;
    }

    // Check if already running
    if super::http_ping(port).await {
        cpa_state.lock().unwrap().status = CpaStatus::Running;
        let _ = app.emit("cpa:status", &CpaStatus::Running);
        return;
    }

    let working_dir = app_config::data_dir(&app);
    match crate::cpa_manager::spawn_cpa(&binary, &working_dir, &cpa_state) {
        Ok(output) => {
            let _ = app.emit("cpa:status", &CpaStatus::Starting);
            crate::log_stream::pipe_process_output(
                app.clone(),
                log_buf,
                output.stdout,
                output.stderr,
            );

            let app2 = app.clone();
            let state2 = cpa_state.clone();
            tauri::async_runtime::spawn(async move {
                for _ in 0..30u32 {
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    if super::http_ping(port).await {
                        state2.lock().unwrap().status = CpaStatus::Running;
                        let _ = app2.emit("cpa:status", &CpaStatus::Running);
                        super::spawn_health_monitor(app2.clone(), state2, port);
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
        }
        Err(e) => {
            let _ = app.emit("cpa:status", &CpaStatus::Error(e));
        }
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
