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
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
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
pub fn write_config_yaml_port(app: AppHandle, port: u16) -> Result<(), String> {
    let path = app_config::config_yaml_path(&app);
    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    let mut value: serde_yaml::Value = if raw.trim().is_empty() {
        serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
    } else {
        serde_yaml::from_str(&raw).map_err(|e| format!("Invalid YAML: {e}"))?
    };
    if let Some(map) = value.as_mapping_mut() {
        map.insert(
            serde_yaml::Value::String("port".into()),
            serde_yaml::Value::Number(serde_yaml::Number::from(port)),
        );
    } else {
        return Err("config.yaml root is not a mapping".into());
    }
    let serialized = serde_yaml::to_string(&value).map_err(|e| e.to_string())?;
    std::fs::write(&path, serialized).map_err(|e| e.to_string())
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
