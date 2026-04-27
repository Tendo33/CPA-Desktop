use crate::app_config::{self, AppSettings};
use crate::cpa_manager::SharedCpaState;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
pub fn get_settings(app: AppHandle) -> AppSettings {
    app_config::load_settings(&app)
}

#[tauri::command]
pub fn save_settings_cmd(
    app: AppHandle,
    state: State<'_, SharedCpaState>,
    settings: AppSettings,
) -> Result<(), String> {
    // Update the live port in the running CPA state
    state.lock().unwrap().port = settings.port;
    app_config::save_settings(&app, &settings)
}

#[tauri::command]
pub fn get_port_from_yaml(app: AppHandle) -> Result<u16, String> {
    app_config::read_port_from_yaml(&app)
}

#[tauri::command]
pub fn get_autolaunch_enabled(app: AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_autolaunch_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let al = app.autolaunch();
    if enabled {
        al.enable().map_err(|e| e.to_string())
    } else {
        al.disable().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn read_config_yaml(app: AppHandle) -> Result<String, String> {
    let path = app_config::config_yaml_path(&app);
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_config_yaml(app: AppHandle, content: String) -> Result<(), String> {
    // Validate YAML before writing
    serde_yaml::from_str::<serde_yaml::Value>(&content)
        .map_err(|e| format!("Invalid YAML: {e}"))?;
    let path = app_config::config_yaml_path(&app);
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let dir = app_config::data_dir(&app);
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
