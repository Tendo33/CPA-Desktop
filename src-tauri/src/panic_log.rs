use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

pub fn install(logs_dir: PathBuf, settings_path: PathBuf) {
    std::panic::set_hook(Box::new(move |info| {
        let _ = create_dir_all(&logs_dir);
        let date = chrono::Local::now().format("%Y%m%d");
        let path = logs_dir.join(format!("panic-{date}.log"));
        let now = chrono::Local::now().to_rfc3339();
        let payload = format!("{now} | {info}\n");
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = f.write_all(payload.as_bytes());
        }
        if let Ok(content) = std::fs::read_to_string(&settings_path) {
            if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                let last_panic = serde_json::json!({
                    "atIso": now,
                    "message": format!("{info}"),
                });
                if let Some(obj) = json.as_object_mut() {
                    obj.insert("lastPanic".into(), last_panic);
                    if let Ok(out) = serde_json::to_string_pretty(&json) {
                        let _ = std::fs::write(&settings_path, out);
                    }
                }
            }
        }
        rotate(&logs_dir);
    }));
}

fn rotate(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("panic-"))
        .collect();
    files.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
    while files.len() > 5 {
        if let Some(old) = files.first() {
            let _ = std::fs::remove_file(old.path());
        }
        files.remove(0);
    }
}
