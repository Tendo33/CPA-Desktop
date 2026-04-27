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
    if path.exists() {
        let backups = app_config::backups_dir(&app);
        std::fs::create_dir_all(&backups).map_err(|e| e.to_string())?;
        let ts = chrono::Local::now().format("%Y%m%dT%H%M%S");
        let backup_path = backups.join(format!("config.yaml.{ts}"));
        let _ = std::fs::copy(&path, &backup_path);
        prune_backups(&backups, 10);
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
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

#[tauri::command]
pub fn list_config_backups(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = app_config::backups_dir(&app);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut names: Vec<(std::time::SystemTime, String)> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let mtime = e.metadata().ok()?.modified().ok()?;
            let name = e.file_name().to_string_lossy().to_string();
            Some((mtime, name))
        })
        .collect();
    names.sort_by_key(|n| std::cmp::Reverse(n.0));
    Ok(names.into_iter().map(|(_, n)| n).collect())
}

#[tauri::command]
pub fn restore_config_backup(app: AppHandle, name: String) -> Result<String, String> {
    let dir = app_config::backups_dir(&app);
    let src = dir.join(&name);
    if !src.exists() {
        return Err(format!("backup '{name}' not found"));
    }
    let dst = app_config::config_yaml_path(&app);
    std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
    std::fs::read_to_string(&dst).map_err(|e| e.to_string())
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
        let Some(map) = cur.as_mapping() else { return Ok(None) };
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
    let raw = read_config_yaml(app.clone()).unwrap_or_default();
    let mut doc: serde_yaml::Value = if raw.trim().is_empty() {
        serde_yaml::Value::Mapping(Default::default())
    } else {
        serde_yaml::from_str(&raw).map_err(|e| format!("Invalid YAML: {e}"))?
    };
    set_path(&mut doc, &path, value)?;
    let out = serde_yaml::to_string(&doc).map_err(|e| e.to_string())?;
    write_config_yaml(app, out)
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
