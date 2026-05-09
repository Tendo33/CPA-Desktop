use std::fs::OpenOptions;
use std::io::Write;
use tauri::{AppHandle, Manager};

const ALLOWED_EVAL_WEBVIEW_LABEL: &str = "cpa-content";

#[tauri::command]
pub fn report_frontend_error(
    app: AppHandle,
    message: String,
    stack: Option<String>,
) -> Result<(), String> {
    let logs = crate::app_config::logs_dir(&app);
    std::fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
    let path = logs.join("frontend-errors.log");
    let now = chrono::Local::now().to_rfc3339();
    let message = crate::log_stream::redact(&message);
    let stack = stack.map(|s| crate::log_stream::redact(&s));
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let line = format!(
        "{now} | {}\n{}\n---\n",
        message,
        stack.as_deref().unwrap_or("(no stack)")
    );
    f.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    log::error!("frontend error: {message}");
    Ok(())
}

/// Probe the CPA management API to figure out whether the embedded panel
/// will work. Returns one of:
///   - "ok"            — 2xx (or 3xx). Panel can authenticate.
///   - "noKey"         — 404. CPA's management routes are disabled
///                       (typically `secret-key: ''`).
///   - "unauthorized"  — 401/403. Key changed / invalid.
///   - "down"          — transport error or 5xx.
#[tauri::command]
pub async fn probe_management_api(app: AppHandle) -> Result<String, String> {
    let settings = crate::app_config::load_settings(&app);
    let key = match crate::app_config::config_yaml_path(&app) {
        path if path.exists() => std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_yaml::from_str::<serde_yaml::Value>(&raw).ok())
            .and_then(|doc| {
                doc.get("remote-management")
                    .and_then(|m| m.get("secret-key"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
            })
            .unwrap_or_default(),
        _ => String::new(),
    };
    let url = format!("http://127.0.0.1:{}/v0/management/config", settings.port);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.get(&url);
    if !key.is_empty() {
        req = req.bearer_auth(&key);
    }
    match req.send().await {
        Ok(resp) => {
            let status = resp.status();
            if status.is_success() || status.is_redirection() {
                Ok("ok".into())
            } else if status.as_u16() == 404 {
                Ok("noKey".into())
            } else if status.as_u16() == 401 || status.as_u16() == 403 {
                Ok("unauthorized".into())
            } else {
                Ok("down".into())
            }
        }
        Err(_) => Ok("down".into()),
    }
}

/// Run a JavaScript snippet inside a labelled child webview. Used by the
/// dashboard to inject auto-login state into the embedded management
/// panel — the JS Webview API in Tauri 2 doesn't expose `eval` on child
/// webviews, only on `WebviewWindow`, so we round-trip through Rust.
///
/// Silently no-ops if the label can't be resolved; the caller treats
/// auto-login as best-effort.
#[tauri::command]
pub fn eval_in_webview(app: AppHandle, label: String, script: String) -> Result<(), String> {
    if label != ALLOWED_EVAL_WEBVIEW_LABEL {
        return Err(format!("webview '{label}' is not allowed for eval"));
    }
    let Some(wv) = app.get_webview(&label) else {
        return Err(format!("webview '{label}' not found"));
    };
    wv.eval(&script).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    let dir = crate::app_config::logs_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::ALLOWED_EVAL_WEBVIEW_LABEL;

    #[test]
    fn eval_webview_label_is_narrowed_to_dashboard_content() {
        assert_eq!(ALLOWED_EVAL_WEBVIEW_LABEL, "cpa-content");
    }
}
