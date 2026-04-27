use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;

pub const SETTINGS_SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_PORT: u16 = 8317;

fn default_schema_version() -> u32 {
    SETTINGS_SCHEMA_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastPanic {
    pub at_iso: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub port: u16,
    pub auto_start: bool,
    pub cpa_version: Option<String>,
    #[serde(default)]
    pub last_panic: Option<LastPanic>,
    #[serde(default)]
    pub auto_check_app_updates: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            port: DEFAULT_PORT,
            auto_start: false,
            cpa_version: None,
            last_panic: None,
            auto_check_app_updates: false,
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

pub fn logs_dir(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("logs")
}

pub fn backups_dir(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("backups")
}

pub fn load_settings(app: &tauri::AppHandle) -> AppSettings {
    load_settings_at(&settings_path(app))
}

/// Load settings from a specific path. Quarantines a corrupt file as
/// `settings.broken.<ts>.json` and returns defaults instead of silently
/// overwriting the user's config on next save.
pub fn load_settings_at(path: &Path) -> AppSettings {
    if !path.exists() {
        return AppSettings::default();
    }
    let raw = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("settings unreadable: {e}; using defaults");
            return AppSettings::default();
        }
    };
    match serde_json::from_str::<AppSettings>(&raw) {
        Ok(s) => s,
        Err(e) => {
            let ts = chrono::Utc::now().format("%Y%m%dT%H%M%S");
            let backup = path.with_file_name(format!("settings.broken.{ts}.json"));
            let _ = std::fs::rename(path, &backup);
            log::error!(
                "settings corrupted: {e}; quarantined to {}",
                backup.display()
            );
            AppSettings::default()
        }
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

/// Read the port value from config.yaml (single source of truth).
pub fn read_port_from_yaml(app: &tauri::AppHandle) -> Result<u16, String> {
    let content = std::fs::read_to_string(config_yaml_path(app)).map_err(|e| e.to_string())?;
    let val: serde_yaml::Value = serde_yaml::from_str(&content).map_err(|e| e.to_string())?;
    val.get("port")
        .and_then(|v| v.as_u64())
        .map(|p| p as u16)
        .ok_or_else(|| "port not found in config.yaml".into())
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

#[cfg(test)]
mod tests {
    fn parse_port(yaml: &str) -> Result<u16, String> {
        let val: serde_yaml::Value = serde_yaml::from_str(yaml).map_err(|e| e.to_string())?;
        val.get("port")
            .and_then(|v| v.as_u64())
            .map(|p| p as u16)
            .ok_or_else(|| "port not found".to_string())
    }

    #[test]
    fn parses_valid_port() {
        assert_eq!(parse_port("port: 8317\n").unwrap(), 8317);
    }

    #[test]
    fn rejects_missing_port() {
        assert!(parse_port("other: 1\n").is_err());
    }

    #[test]
    fn rejects_string_port() {
        assert!(parse_port("port: \"abc\"\n").is_err());
    }
}
