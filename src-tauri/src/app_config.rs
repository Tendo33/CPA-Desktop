use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub port: u16,
    pub auto_start: bool,
    pub cpa_version: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            port: 8317,
            auto_start: true,
            cpa_version: None,
        }
    }
}

pub fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir().expect("app data dir unavailable")
}

pub fn bin_dir(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("bin")
}

pub fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("data")
}

pub fn cpa_binary_path(app: &tauri::AppHandle) -> PathBuf {
    let name = if cfg!(target_os = "windows") {
        "cli-proxy-api.exe"
    } else {
        "cli-proxy-api"
    };
    bin_dir(app).join(name)
}

pub fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("app-settings.json")
}

pub fn config_yaml_path(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("config.yaml")
}

pub fn load_settings(app: &tauri::AppHandle) -> AppSettings {
    let path = settings_path(app);
    if let Ok(content) = std::fs::read_to_string(&path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        AppSettings::default()
    }
}

pub fn save_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

pub fn ensure_dirs(app: &tauri::AppHandle) -> Result<(), String> {
    for dir in [bin_dir(app), data_dir(app)] {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Bootstrap config.yaml from embedded example if not present.
pub fn ensure_config_yaml(app: &tauri::AppHandle) -> Result<(), String> {
    let path = config_yaml_path(app);
    if path.exists() {
        return Ok(());
    }
    let example = include_str!("../assets/config.example.yaml");
    std::fs::write(&path, example).map_err(|e| e.to_string())
}
