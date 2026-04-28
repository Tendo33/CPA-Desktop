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
    /// How long to wait for CPA to answer its health endpoint after
    /// spawn before declaring startup failure. Slow disks / first-time
    /// model downloads need more than the default 30s.
    #[serde(default = "default_start_timeout_secs")]
    pub start_timeout_secs: u32,
    /// Whether the health monitor should attempt to relaunch CPA after
    /// it crashes (bounded retry with exponential backoff).
    #[serde(default = "default_auto_restart")]
    pub auto_restart: bool,
    /// HTTP path used for liveness probes. Configurable so deployments
    /// fronted by a reverse proxy can point us at the real health route.
    #[serde(default = "default_health_path")]
    pub health_path: String,
}

fn default_start_timeout_secs() -> u32 {
    60
}
fn default_auto_restart() -> bool {
    true
}
fn default_health_path() -> String {
    "/health".to_string()
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
            start_timeout_secs: default_start_timeout_secs(),
            auto_restart: default_auto_restart(),
            health_path: default_health_path(),
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
    atomic_write(&path, json.as_bytes()).map_err(|e| e.to_string())
}

/// Write `bytes` to `path` atomically: write to a sibling tempfile,
/// fsync the data, then rename over the destination. Avoids leaving the
/// destination half-written if the process is killed mid-write.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "path has no parent")
    })?;
    std::fs::create_dir_all(parent)?;
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "tmp".into());
    // Use the process id + nanos to avoid collisions if multiple writers
    // race on the same destination.
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = parent.join(format!(".{file_name}.tmp.{}.{stamp}", std::process::id()));
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    // `std::fs::rename` is atomic on both POSIX (rename(2)) and Windows
    // (MoveFileExW with MOVEFILE_REPLACE_EXISTING). Calling `remove_file`
    // first would *introduce* a window where `path` doesn't exist — the
    // exact failure mode atomic_write is supposed to prevent.
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }

    // Best-effort: fsync the parent directory so the rename is durable
    // across power loss on POSIX. Windows journals dir entries with the
    // file write, so this is a no-op there.
    #[cfg(unix)]
    {
        if let Ok(dir) = std::fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }

    Ok(())
}

#[cfg(test)]
mod atomic_write_tests {
    use super::atomic_write;

    #[test]
    fn writes_full_payload_to_destination() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        atomic_write(&path, b"{\"hello\":\"world\"}").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"{\"hello\":\"world\"}");
    }

    #[test]
    fn replaces_existing_destination_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, b"old").unwrap();
        atomic_write(&path, b"new-and-longer").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new-and-longer");
        // No leftover sidecar tmp files.
        let stray: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| n.starts_with(".settings.json.tmp."))
            .collect();
        assert!(stray.is_empty(), "stale tmp left behind: {stray:?}");
    }

    #[test]
    fn errors_when_parent_directory_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nope/sub/settings.json");
        // We *do* create_dir_all internally, so this should succeed.
        atomic_write(&path, b"x").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"x");
    }
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
