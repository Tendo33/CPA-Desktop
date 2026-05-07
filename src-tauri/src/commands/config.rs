use crate::app_config::{self, AppSettings};
use crate::cpa_manager::SharedCpaState;
use base64::Engine;
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_autostart::ManagerExt;

/// Snapshot of "is the user ready to actually use CPA?" — the single source
/// of truth that the first-run wizard reads to decide which steps to show.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    /// CPA binary exists at the resolved path.
    pub binary_present: bool,
    /// `config.yaml` exists at the resolved path.
    pub config_present: bool,
    /// `remote-management.secret-key` is non-empty (otherwise management API → 404).
    pub secret_key_set: bool,
    /// `api-keys` is non-empty AND contains no `your-api-key-*` placeholder.
    pub api_keys_configured: bool,
    /// Something is already answering the configured port — we should attach
    /// rather than spawn (covers `brew services start cliproxyapi`).
    pub cpa_already_running: bool,
    /// Active install source kind, surfaced to the wizard so it can adapt
    /// (e.g. external sources skip the download step).
    pub install_source_kind: String,
}

#[tauri::command]
pub async fn get_setup_status(app: AppHandle) -> Result<SetupStatus, String> {
    let settings = app_config::load_settings(&app);
    let binary = app_config::cpa_binary_path(&app);
    let config_path = app_config::config_yaml_path(&app);

    let binary_present = binary.exists();
    let config_present = config_path.exists();

    let (secret_key_set, api_keys_configured) = if config_present {
        match std::fs::read_to_string(&config_path) {
            Ok(raw) => match serde_yaml::from_str::<serde_yaml::Value>(&raw) {
                Ok(doc) => (config_has_secret_key(&doc), config_has_real_api_keys(&doc)),
                Err(_) => (false, false),
            },
            Err(_) => (false, false),
        }
    } else {
        (false, false)
    };

    let cpa_already_running = crate::is_cpa_service(settings.port, &settings.health_path).await;
    let install_source_kind = match &settings.install_source {
        crate::install_source::InstallSource::Managed => "managed",
        crate::install_source::InstallSource::Homebrew { .. } => "homebrew",
        crate::install_source::InstallSource::SystemPath { .. } => "systemPath",
        crate::install_source::InstallSource::Custom { .. } => "custom",
    }
    .to_string();

    Ok(SetupStatus {
        binary_present,
        config_present,
        secret_key_set,
        api_keys_configured,
        cpa_already_running,
        install_source_kind,
    })
}

fn config_has_secret_key(doc: &serde_yaml::Value) -> bool {
    let Some(rm) = doc.get("remote-management") else {
        return false;
    };
    let Some(key) = rm.get("secret-key") else {
        return false;
    };
    key.as_str().map(|s| !s.trim().is_empty()).unwrap_or(false)
}

fn config_has_real_api_keys(doc: &serde_yaml::Value) -> bool {
    let Some(arr) = doc.get("api-keys").and_then(|v| v.as_sequence()) else {
        return false;
    };
    if arr.is_empty() {
        return false;
    }
    arr.iter().all(|item| {
        item.as_str()
            .map(|s| {
                let trimmed = s.trim();
                !trimmed.is_empty() && !trimmed.starts_with("your-api-key")
            })
            .unwrap_or(false)
    })
}

/// Generate a cryptographically strong secret. Returns 32 random bytes
/// encoded as base64url without padding (~43 chars). Used for both
/// `remote-management.secret-key` and `api-keys` entries.
#[tauri::command]
pub fn generate_secret() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Initialize the managed config.yaml with a generated secret-key and one
/// generated api-key, returning the values so the wizard can show them.
/// Idempotent: if secret-key / api-keys are already set, the existing
/// values are preserved and returned.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializedCredentials {
    pub secret_key: String,
    pub api_keys: Vec<String>,
}

#[tauri::command]
pub fn initialize_credentials(app: AppHandle) -> Result<InitializedCredentials, String> {
    // Make sure config.yaml exists (managed source only). For external
    // sources we never overwrite — return what's already there if present.
    app_config::ensure_config_yaml(&app)?;
    let path = app_config::config_yaml_path(&app);
    let mut doc = config_doc_for_write(std::fs::read_to_string(&path))?;

    // Ensure remote-management.secret-key
    let secret_key = {
        let map = doc
            .as_mapping_mut()
            .ok_or_else(|| "config root is not a mapping".to_string())?;
        let rm_key = serde_yaml::Value::String("remote-management".into());
        if !map.contains_key(&rm_key) {
            map.insert(
                rm_key.clone(),
                serde_yaml::Value::Mapping(Default::default()),
            );
        }
        let rm = map.get_mut(&rm_key).unwrap();
        let rm_map = rm
            .as_mapping_mut()
            .ok_or_else(|| "remote-management is not a mapping".to_string())?;
        let sk_key = serde_yaml::Value::String("secret-key".into());
        let existing = rm_map
            .get(&sk_key)
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        if existing.is_empty() {
            let new_key = generate_secret();
            rm_map.insert(sk_key, serde_yaml::Value::String(new_key.clone()));
            new_key
        } else {
            existing
        }
    };

    // Ensure api-keys has at least one real entry
    let api_keys = {
        let map = doc.as_mapping_mut().unwrap();
        let ak_key = serde_yaml::Value::String("api-keys".into());
        let mut keys = retain_initialized_api_keys(map.get(&ak_key)).unwrap_or_default();
        if keys.is_empty() {
            let new_key = generate_secret();
            keys.push(new_key);
        }
        map.insert(
            ak_key.clone(),
            serde_yaml::Value::Sequence(
                keys.iter()
                    .cloned()
                    .map(serde_yaml::Value::String)
                    .collect(),
            ),
        );
        keys
    };

    let serialized = serde_yaml::to_string(&doc).map_err(|e| e.to_string())?;
    app_config::atomic_write(&path, serialized.as_bytes()).map_err(|e| e.to_string())?;

    Ok(InitializedCredentials {
        secret_key,
        api_keys,
    })
}

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
    validate_port(settings.port)?;
    app_config::save_settings(&app, &settings)?;
    // Update the live port in the running CPA state.
    state.lock().unwrap().port = settings.port;
    let _ = app.emit("cpa:port", settings.port);
    Ok(())
}

#[tauri::command]
pub fn get_port_from_yaml(app: AppHandle) -> Result<u16, String> {
    app_config::read_port_from_yaml(&app)
}

#[tauri::command]
pub fn set_cpa_port(
    app: AppHandle,
    state: State<'_, SharedCpaState>,
    port: u16,
) -> Result<(), String> {
    validate_port(port)?;
    write_config_yaml_port(app.clone(), port)?;

    let mut settings = app_config::load_settings(&app);
    settings.port = port;
    app_config::save_settings(&app, &settings)?;

    state.lock().unwrap().port = port;
    app.emit("cpa:port", port).map_err(|e| e.to_string())?;
    Ok(())
}

fn validate_port(port: u16) -> Result<(), String> {
    if port == 0 {
        Err("port 0 is not a valid TCP port (1-65535)".into())
    } else {
        Ok(())
    }
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
    let path = app_config::config_yaml_path(&app);
    let backups = app_config::backups_dir(&app);
    write_config_yaml_with_backup(&path, &backups, &content)
}

fn backup_current_config(config_path: &Path, backups_dir: &Path) -> Result<(), String> {
    if !config_path.exists() {
        return Ok(());
    }
    std::fs::create_dir_all(backups_dir).map_err(|e| e.to_string())?;
    let now = chrono::Local::now();
    let ts = now.format("%Y%m%dT%H%M%S");
    let nanos = now
        .timestamp_nanos_opt()
        .unwrap_or_else(|| now.timestamp_micros() * 1_000);
    let backup_path = backups_dir.join(format!("config.yaml.{ts}.{nanos}"));
    std::fs::copy(config_path, &backup_path).map_err(|e| e.to_string())?;
    prune_backups(backups_dir, 10);
    Ok(())
}

fn write_config_yaml_with_backup(
    config_path: &Path,
    backups_dir: &Path,
    content: &str,
) -> Result<(), String> {
    serde_yaml::from_str::<serde_yaml::Value>(content).map_err(|e| format!("Invalid YAML: {e}"))?;
    backup_current_config(config_path, backups_dir)?;
    app_config::atomic_write(config_path, content.as_bytes()).map_err(|e| e.to_string())
}

fn prune_backups(dir: &std::path::Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    files.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
    while files.len() > keep {
        if let Some(old) = files.first() {
            let _ = std::fs::remove_file(old.path());
        }
        files.remove(0);
    }
}

fn set_path(
    doc: &mut serde_yaml::Value,
    path: &str,
    value: serde_json::Value,
) -> Result<(), String> {
    let parts: Vec<&str> = path.split('.').filter(|p| !p.is_empty()).collect();
    if parts.is_empty() {
        return Err("empty path".into());
    }
    let mut cur = doc;
    for p in &parts[..parts.len() - 1] {
        let map = cur
            .as_mapping_mut()
            .ok_or_else(|| format!("'{p}' is not a mapping"))?;
        let key = serde_yaml::Value::String((*p).to_string());
        if !map.contains_key(&key) {
            map.insert(key.clone(), serde_yaml::Value::Mapping(Default::default()));
        }
        cur = map.get_mut(&key).unwrap();
    }
    let last = *parts.last().unwrap();
    let map = cur
        .as_mapping_mut()
        .ok_or_else(|| "leaf parent is not a mapping".to_string())?;
    map.insert(
        serde_yaml::Value::String(last.to_string()),
        serde_yaml::to_value(&value).map_err(|e| e.to_string())?,
    );
    Ok(())
}

fn retain_initialized_api_keys(value: Option<&serde_yaml::Value>) -> Result<Vec<String>, String> {
    let Some(value) = value else {
        return Ok(vec![]);
    };
    let seq = value
        .as_sequence()
        .ok_or_else(|| "api-keys is not a sequence".to_string())?;
    Ok(seq
        .iter()
        .filter_map(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && !s.starts_with("your-api-key"))
        .map(|s| s.to_string())
        .collect())
}

fn config_doc_for_write(read: Result<String, std::io::Error>) -> Result<serde_yaml::Value, String> {
    match read {
        Ok(raw) => {
            if raw.trim().is_empty() {
                Ok(serde_yaml::Value::Mapping(Default::default()))
            } else {
                serde_yaml::from_str(&raw).map_err(|e| format!("Invalid YAML: {e}"))
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            Ok(serde_yaml::Value::Mapping(Default::default()))
        }
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
pub fn read_config_field(
    app: AppHandle,
    path: String,
) -> Result<Option<serde_json::Value>, String> {
    let raw = read_config_yaml(app)?;
    let doc: serde_yaml::Value =
        serde_yaml::from_str(&raw).map_err(|e| format!("Invalid YAML: {e}"))?;
    let mut cur = &doc;
    for p in path.split('.').filter(|p| !p.is_empty()) {
        let Some(map) = cur.as_mapping() else {
            return Ok(None);
        };
        let Some(next) = map.get(serde_yaml::Value::String(p.to_string())) else {
            return Ok(None);
        };
        cur = next;
    }
    Ok(Some(serde_json::to_value(cur).map_err(|e| e.to_string())?))
}

#[tauri::command]
pub fn write_config_field(
    app: AppHandle,
    path: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let path_buf = app_config::config_yaml_path(&app);
    let mut doc = config_doc_for_write(std::fs::read_to_string(&path_buf))?;
    set_path(&mut doc, &path, value)?;
    let out = serde_yaml::to_string(&doc).map_err(|e| e.to_string())?;
    write_config_yaml(app, out)
}

#[tauri::command]
pub fn write_config_yaml_port(app: AppHandle, port: u16) -> Result<(), String> {
    validate_port(port)?;
    let path = app_config::config_yaml_path(&app);
    let mut value = config_doc_for_write(std::fs::read_to_string(&path))?;
    if let Some(map) = value.as_mapping_mut() {
        map.insert(
            serde_yaml::Value::String("port".into()),
            serde_yaml::Value::Number(serde_yaml::Number::from(port)),
        );
    } else {
        return Err("config.yaml root is not a mapping".into());
    }
    let serialized = serde_yaml::to_string(&value).map_err(|e| e.to_string())?;
    let backups = app_config::backups_dir(&app);
    write_config_yaml_with_backup(&path, &backups, &serialized)
}

#[tauri::command]
pub fn open_data_dir(app: AppHandle) -> Result<(), String> {
    // Prefer the directory holding config.yaml — that's what users mean
    // by "data folder", and for external install sources it's distinct
    // from the working dir.
    let cfg = app_config::config_yaml_path(&app);
    let mut dir = cfg
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| app_config::data_dir(&app));
    // For external sources the conventional config dir may not exist yet
    // (e.g. SystemPath default `~/.cli-proxy-api/`). Try to create it; if
    // that fails (read-only / permission), fall back to our always-writable
    // internal data dir so the user still gets *something* useful opened.
    if !dir.is_dir() && std::fs::create_dir_all(&dir).is_err() {
        dir = app_config::internal_data_dir(&app);
        let _ = std::fs::create_dir_all(&dir);
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_secret_is_url_safe_and_long_enough() {
        let s = generate_secret();
        assert!(s.len() >= 40, "secret too short: {} chars", s.len());
        assert!(
            s.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'),
            "secret contains non-url-safe char: {s}"
        );
        let s2 = generate_secret();
        assert_ne!(s, s2, "two consecutive generations must differ");
    }

    #[test]
    fn config_has_secret_key_detects_empty_and_set() {
        let empty: serde_yaml::Value =
            serde_yaml::from_str("remote-management:\n  secret-key: ''\n").unwrap();
        assert!(!config_has_secret_key(&empty));

        let set: serde_yaml::Value =
            serde_yaml::from_str("remote-management:\n  secret-key: 'abc123'\n").unwrap();
        assert!(config_has_secret_key(&set));

        let missing: serde_yaml::Value = serde_yaml::from_str("port: 8317\n").unwrap();
        assert!(!config_has_secret_key(&missing));

        let whitespace: serde_yaml::Value =
            serde_yaml::from_str("remote-management:\n  secret-key: '   '\n").unwrap();
        assert!(!config_has_secret_key(&whitespace));
    }

    #[test]
    fn config_has_real_api_keys_rejects_placeholder() {
        let placeholder: serde_yaml::Value =
            serde_yaml::from_str("api-keys:\n  - your-api-key-1\n  - your-api-key-2\n").unwrap();
        assert!(!config_has_real_api_keys(&placeholder));

        let mixed: serde_yaml::Value =
            serde_yaml::from_str("api-keys:\n  - real-key-abc\n  - your-api-key-1\n").unwrap();
        assert!(!config_has_real_api_keys(&mixed));

        let real: serde_yaml::Value =
            serde_yaml::from_str("api-keys:\n  - real-key-abc\n  - real-key-def\n").unwrap();
        assert!(config_has_real_api_keys(&real));

        let empty: serde_yaml::Value = serde_yaml::from_str("api-keys: []\n").unwrap();
        assert!(!config_has_real_api_keys(&empty));

        let missing: serde_yaml::Value = serde_yaml::from_str("port: 8317\n").unwrap();
        assert!(!config_has_real_api_keys(&missing));
    }

    #[test]
    fn read_write_config_field_round_trips_dashed_keys() {
        let mut doc: serde_yaml::Value = serde_yaml::from_str("port: 8317\n").unwrap();
        set_path(
            &mut doc,
            "remote-management.secret-key",
            serde_json::json!("abc-123"),
        )
        .unwrap();
        let out = serde_yaml::to_string(&doc).unwrap();
        assert!(out.contains("remote-management:"));
        assert!(out.contains("secret-key: abc-123"));

        let parsed: serde_yaml::Value = serde_yaml::from_str(&out).unwrap();
        let v = parsed
            .get("remote-management")
            .and_then(|m| m.get("secret-key"))
            .and_then(|v| v.as_str())
            .unwrap();
        assert_eq!(v, "abc-123");
    }

    #[test]
    fn prune_backups_keeps_only_n_newest() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..15 {
            let p = tmp.path().join(format!("config.yaml.{i}"));
            std::fs::write(&p, format!("v{i}")).unwrap();
            // Ensure mtimes order by sleeping briefly is overkill; keep order by name.
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        prune_backups(tmp.path(), 10);
        let count = std::fs::read_dir(tmp.path()).unwrap().count();
        assert_eq!(count, 10);
    }

    #[test]
    fn write_config_yaml_with_backup_snapshots_existing_file() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("config.yaml");
        let backups_dir = tmp.path().join("backups");
        std::fs::write(&config_path, "port: 8317\n").unwrap();

        write_config_yaml_with_backup(&config_path, &backups_dir, "port: 8318\n").unwrap();

        assert_eq!(
            std::fs::read_to_string(&config_path).unwrap(),
            "port: 8318\n"
        );
        let backups: Vec<_> = std::fs::read_dir(&backups_dir).unwrap().collect();
        assert_eq!(backups.len(), 1);
        let backup = backups.into_iter().next().unwrap().unwrap();
        assert_eq!(
            std::fs::read_to_string(backup.path()).unwrap(),
            "port: 8317\n"
        );
    }

    #[test]
    fn initialize_credentials_preserves_real_api_keys_when_placeholders_exist() {
        let doc: serde_yaml::Value = serde_yaml::from_str(
            "api-keys:\n  - real-key-abc\n  - your-api-key-1\n  - '   '\n  - real-key-def\n",
        )
        .unwrap();

        let preserved = retain_initialized_api_keys(doc.get("api-keys")).unwrap();

        assert_eq!(preserved, vec!["real-key-abc", "real-key-def"]);
    }

    #[test]
    fn write_config_helpers_must_not_treat_read_errors_as_empty_config() {
        let err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
        let doc = config_doc_for_write(Err(err));

        assert!(
            doc.is_err(),
            "permission failures must not become empty config"
        );
    }

    #[test]
    fn write_config_helpers_allow_missing_files_to_start_empty() {
        let err = std::io::Error::new(std::io::ErrorKind::NotFound, "missing");
        let doc = config_doc_for_write(Err(err)).unwrap();

        assert!(doc.as_mapping().is_some());
    }
}
