use std::fs::OpenOptions;
use std::io::Write;
use tauri::AppHandle;

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

#[tauri::command]
pub fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    let dir = crate::app_config::logs_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}
