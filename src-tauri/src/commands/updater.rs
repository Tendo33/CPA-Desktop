use crate::app_config;
use crate::cpa_manager::SharedCpaState;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: Option<String>,
    pub latest_version: String,
    pub update_available: bool,
    pub download_url: String,
}

fn asset_name(version: &str) -> String {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        other => other,
    };
    let ext = if cfg!(target_os = "windows") { "zip" } else { "tar.gz" };
    let ver = version.trim_start_matches('v');
    format!("CLIProxyAPI_{ver}_{os}_{arch}.{ext}")
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    assets: Vec<GhAsset>,
}

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

#[tauri::command]
pub async fn check_cpa_update(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let settings = app_config::load_settings(&app);

    let client = reqwest::Client::builder()
        .user_agent("CPA-Desktop/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let release: GhRelease = client
        .get("https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let name = asset_name(&release.tag_name);
    let asset = release
        .assets
        .iter()
        .find(|a| a.name == name)
        .ok_or_else(|| format!("No asset found for: {name}"))?;

    let current = settings.cpa_version.clone();
    let update_available = current
        .as_deref()
        .map(|v| v != release.tag_name)
        .unwrap_or(true);

    Ok(UpdateCheckResult {
        current_version: current,
        latest_version: release.tag_name,
        update_available,
        download_url: asset.browser_download_url.clone(),
    })
}

#[tauri::command]
pub async fn download_cpa_update(
    app: AppHandle,
    download_url: String,
    version: String,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("CPA-Desktop/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        buf.extend_from_slice(&chunk);
        if total > 0 {
            let _ = app.emit("cpa:download-progress", (downloaded, total));
        }
    }

    // Ensure CPA is fully stopped before replacing binary (critical on Windows)
    if let Some(cpa_state) = app.try_state::<SharedCpaState>() {
        crate::cpa_manager::kill_cpa(&cpa_state);
        // Give OS time to release file locks
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }

    let bin_dir = app_config::bin_dir(&app);
    std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;

    let binary_name = if cfg!(target_os = "windows") {
        "cli-proxy-api.exe"
    } else {
        "cli-proxy-api"
    };

    // On Windows, rename the old binary before overwriting (avoids EBUSY/EACCES)
    #[cfg(target_os = "windows")]
    {
        let old_path = bin_dir.join(binary_name);
        if old_path.exists() {
            let backup = bin_dir.join("cli-proxy-api.exe.old");
            let _ = std::fs::remove_file(&backup); // remove stale backup
            let _ = std::fs::rename(&old_path, &backup);
        }
    }

    if download_url.ends_with(".zip") {
        extract_zip(&buf, binary_name, &bin_dir)?;
    } else {
        extract_targz(&buf, binary_name, &bin_dir)?;
    }

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let bin_path = bin_dir.join(binary_name);
        let mut perms = std::fs::metadata(&bin_path)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&bin_path, perms).map_err(|e| e.to_string())?;
    }

    // Save version
    let mut settings = app_config::load_settings(&app);
    settings.cpa_version = Some(version);
    app_config::save_settings(&app, &settings)?;

    let _ = app.emit("cpa:download-complete", ());
    Ok(())
}

fn extract_zip(data: &[u8], binary_name: &str, dest: &std::path::Path) -> Result<(), String> {
    use std::io::Read;
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let file_name = std::path::Path::new(file.name())
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();

        if file_name == binary_name {
            let out_path = dest.join(binary_name);
            let mut content = Vec::new();
            file.read_to_end(&mut content).map_err(|e| e.to_string())?;
            std::fs::write(&out_path, content).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err(format!("{binary_name} not found in zip"))
}

fn extract_targz(data: &[u8], binary_name: &str, dest: &std::path::Path) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use std::io::Read;
    use tar::Archive;

    let cursor = std::io::Cursor::new(data);
    let gz = GzDecoder::new(cursor);
    let mut archive = Archive::new(gz);

    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?;
        let file_name = path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();

        if file_name == binary_name {
            let out_path = dest.join(binary_name);
            let mut content = Vec::new();
            entry.read_to_end(&mut content).map_err(|e| e.to_string())?;
            std::fs::write(&out_path, content).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err(format!("{binary_name} not found in tar.gz"))
}
