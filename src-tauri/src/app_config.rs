use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Manager;

use crate::install_source::{InstallSource, ManagedContext, ResolvedPaths};

pub const SETTINGS_SCHEMA_VERSION: u32 = 2;
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
    #[serde(default = "default_mirrors")]
    pub mirrors: Vec<String>,
    /// Where the CPA binary lives. Missing in v1 settings → defaults to
    /// `Managed`, preserving existing behaviour.
    #[serde(default)]
    pub install_source: InstallSource,
}

fn default_mirrors() -> Vec<String> {
    vec![
        "github.com".to_string(),
        "gh-proxy.com".to_string(),
        "ghproxy.com".to_string(),
    ]
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
            mirrors: default_mirrors(),
            install_source: InstallSource::default(),
        }
    }
}

pub fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir().expect("app data dir unavailable")
}

/// Always-present directory for the *managed* binary, regardless of the
/// active `InstallSource`. Used by the updater for downloads.
pub fn bin_dir(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("bin")
}

/// Always-present directory for app-internal state: settings, logs,
/// the managed config.yaml, and backups. Independent of `InstallSource`.
pub fn internal_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("data")
}

fn managed_context(app: &tauri::AppHandle) -> ManagedContext {
    ManagedContext {
        bin_dir: bin_dir(app),
        data_dir: internal_data_dir(app),
    }
}

/// Resolve all CPA paths according to the active install source.
pub fn resolve_paths(app: &tauri::AppHandle) -> ResolvedPaths {
    let s = load_settings(app);
    s.install_source.resolve(&managed_context(app))
}

pub fn cpa_binary_path(app: &tauri::AppHandle) -> PathBuf {
    resolve_paths(app).binary
}

/// Path to the CPA process working directory. Used both as `cwd` for the
/// child process and as a fallback location when looking for `config.yaml`.
pub fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    resolve_paths(app).working_dir
}

pub fn config_yaml_path(app: &tauri::AppHandle) -> PathBuf {
    resolve_paths(app).config
}

pub fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("app-settings.json")
}

/// Logs and backups always live under our internal data dir, regardless
/// of where CPA itself is installed — they're our state, not CPA's.
pub fn logs_dir(app: &tauri::AppHandle) -> PathBuf {
    internal_data_dir(app).join("logs")
}

pub fn backups_dir(app: &tauri::AppHandle) -> PathBuf {
    internal_data_dir(app).join("backups")
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
        Ok(mut s) => {
            // Migrate v1 → v2: stamp the schema so subsequent saves carry it.
            if s.schema_version < SETTINGS_SCHEMA_VERSION {
                log::info!(
                    "settings: migrating schema {} → {}",
                    s.schema_version,
                    SETTINGS_SCHEMA_VERSION
                );
                s.schema_version = SETTINGS_SCHEMA_VERSION;
            }
            s
        }
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
    // We always create our internal directories; external install sources
    // own their own directories and we never touch them.
    for dir in [bin_dir(app), internal_data_dir(app)] {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Read the port value from config.yaml (single source of truth).
pub fn read_port_from_yaml(app: &tauri::AppHandle) -> Result<u16, String> {
    read_port_from_path(&config_yaml_path(app))
}

/// Read the port value from a specific config.yaml path. Useful when
/// validating/migrating a candidate install source before it has been
/// persisted as the active source.
pub fn read_port_from_path(path: &Path) -> Result<u16, String> {
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let val: serde_yaml::Value = serde_yaml::from_str(&content).map_err(|e| e.to_string())?;
    val.get("port")
        .and_then(|v| v.as_u64())
        .map(|p| p as u16)
        .ok_or_else(|| "port not found in config.yaml".into())
}

/// Bootstrap config.yaml from embedded example if not present.
///
/// Only applies to the *managed* install source. For external sources we
/// must not create files we don't own.
pub fn ensure_config_yaml(app: &tauri::AppHandle) -> Result<(), String> {
    let settings = load_settings(app);
    if settings.install_source.is_external() {
        return Ok(());
    }
    let path = config_yaml_path(app);
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let example = include_str!("../assets/config.example.yaml");
    std::fs::write(&path, example).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn loads_v1_settings_and_migrates_to_v2() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("app-settings.json");
        // V1 shape: no schema_version, no install_source, no mirrors, no autoCheckAppUpdates.
        let v1 = r#"{
            "port": 9000,
            "autoStart": true,
            "cpaVersion": "v1.2.3"
        }"#;
        std::fs::write(&path, v1).unwrap();

        let s = load_settings_at(&path);
        assert_eq!(s.schema_version, SETTINGS_SCHEMA_VERSION);
        assert_eq!(s.port, 9000);
        assert!(s.auto_start);
        assert_eq!(s.cpa_version.as_deref(), Some("v1.2.3"));
        assert_eq!(s.install_source, InstallSource::Managed);
        assert!(!s.mirrors.is_empty());
    }

    #[test]
    fn corrupt_settings_quarantined_and_defaults_returned() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("app-settings.json");
        std::fs::write(&path, "{not json").unwrap();

        let s = load_settings_at(&path);
        assert_eq!(s.port, DEFAULT_PORT);
        // Original file moved to settings.broken.<ts>.json
        assert!(!path.exists());
        let mut found_broken = false;
        for entry in std::fs::read_dir(tmp.path()).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("settings.broken.") && name.ends_with(".json") {
                found_broken = true;
            }
        }
        assert!(found_broken, "broken settings file should be quarantined");
    }

    #[test]
    fn v2_settings_preserve_install_source() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("app-settings.json");
        let v2 = r#"{
            "schemaVersion": 2,
            "port": 8317,
            "autoStart": false,
            "cpaVersion": null,
            "installSource": { "kind": "homebrew", "prefix": "/opt/homebrew" }
        }"#;
        std::fs::write(&path, v2).unwrap();

        let s = load_settings_at(&path);
        assert_eq!(
            s.install_source,
            InstallSource::Homebrew {
                prefix: PathBuf::from("/opt/homebrew"),
            }
        );
    }
}
