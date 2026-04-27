use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Listener, Manager,
};

use crate::cpa_manager::CpaStatus;

const TRAY_ID: &str = "main";

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::new("Open Dashboard")
        .id("show")
        .build(app)?;
    let start = MenuItemBuilder::new("Start CPA").id("start").build(app)?;
    let stop = MenuItemBuilder::new("Stop CPA").id("stop").build(app)?;
    let open_logs = MenuItemBuilder::new("Open Log Folder")
        .id("open-logs")
        .build(app)?;
    let check_updates = MenuItemBuilder::new("Check for Updates")
        .id("check-updates")
        .build(app)?;
    let sep1 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let sep2 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let sep3 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::new("Quit CPA Desktop")
        .id("quit")
        .build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&sep1)
        .item(&start)
        .item(&stop)
        .item(&sep2)
        .item(&open_logs)
        .item(&check_updates)
        .item(&sep3)
        .item(&quit)
        .build()?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("CPA Desktop — Stopped")
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "start" => {
                let app_c = app.clone();
                crate::util::spawn::supervised(async move {
                    let _ = crate::cpa_lifecycle::start(app_c).await;
                });
            }
            "stop" => crate::cpa_lifecycle::stop(app),
            "open-logs" => {
                let dir = crate::app_config::logs_dir(app);
                let _ = std::fs::create_dir_all(&dir);
                let _ =
                    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>);
            }
            "check-updates" => {
                let _ = app.emit("app:check-updates", ());
            }
            "quit" => {
                crate::cpa_lifecycle::stop(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    let app3 = app.clone();
    app.listen("cpa:status", move |event| {
        let tooltip = match serde_json::from_str::<CpaStatus>(event.payload()) {
            Ok(CpaStatus::Running) => "CPA Desktop — Running ✓",
            Ok(CpaStatus::Starting) => "CPA Desktop — Starting…",
            Ok(CpaStatus::Stopped) => "CPA Desktop — Stopped",
            Ok(CpaStatus::Idle) => "CPA Desktop — Not downloaded",
            Ok(CpaStatus::Error(_)) => "CPA Desktop — Error",
            Err(_) => "CPA Desktop",
        };
        if let Some(tray) = app3.tray_by_id(TRAY_ID) {
            let _ = tray.set_tooltip(Some(tooltip));
        }
    });

    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
