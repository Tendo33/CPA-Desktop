use crate::app_config;
use crate::cpa_manager::SharedCpaState;
use crate::install_source::{InstallSource, UpdateStrategy};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: Option<String>,
    pub latest_version: String,
    pub update_available: bool,
    pub download_url: String,
    /// What the UI should do when the user clicks "Update". Mirrors
    /// `InstallSource::update_strategy()`.
    pub strategy: UpdateStrategy,
}

fn asset_name(version: &str) -> String {
    asset_name_for(version, std::env::consts::OS, std::env::consts::ARCH)
}

fn asset_name_for(version: &str, os: &str, arch: &str) -> String {
    let os_tag = match os {
        "windows" => "windows",
        "macos" => "darwin",
        _ => "linux",
    };
    let arch_tag = match arch {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        other => other,
    };
    let ext = if os == "windows" { "zip" } else { "tar.gz" };
    let ver = version.trim_start_matches('v');
    format!("CLIProxyAPI_{ver}_{os_tag}_{arch_tag}.{ext}")
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
        strategy: settings.install_source.update_strategy(),
    })
}

async fn download_with_mirrors(
    app: &AppHandle,
    client: &reqwest::Client,
    original_url: &str,
    mirrors: &[String],
    partial_path: &std::path::Path,
) -> Result<Vec<u8>, String> {
    use futures_util::StreamExt;
    use std::io::Write;

    let mut last_err: Option<String> = None;

    for mirror in mirrors {
        let url = apply_mirror(original_url, mirror);
        log::info!("attempting download via mirror '{mirror}': {url}");

        // Existing partial size for resume
        let mut downloaded: u64 = std::fs::metadata(partial_path)
            .map(|m| m.len())
            .unwrap_or(0);

        let mut req = client.get(&url);
        if downloaded > 0 {
            req = req.header("Range", format!("bytes={downloaded}-"));
        }

        let resp = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = Some(format!("{mirror}: {e}"));
                continue;
            }
        };

        let status = resp.status();
        if !status.is_success() {
            last_err = Some(format!("{mirror}: HTTP {status}"));
            continue;
        }

        // If server ignored Range, restart from zero.
        if downloaded > 0 && status.as_u16() == 200 {
            let _ = std::fs::remove_file(partial_path);
            downloaded = 0;
        }

        let total = resp.content_length().unwrap_or(0) + downloaded;

        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(partial_path)
            .map_err(|e| e.to_string())?;

        let mut stream = resp.bytes_stream();
        let mut stream_failed = false;
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(c) => {
                    if let Err(e) = file.write_all(&c) {
                        last_err = Some(format!("{mirror}: write error: {e}"));
                        stream_failed = true;
                        break;
                    }
                    downloaded += c.len() as u64;
                    if total > 0 {
                        let _ = app.emit("cpa:download-progress", (downloaded, total));
                    }
                }
                Err(e) => {
                    last_err = Some(format!("{mirror}: stream error: {e}"));
                    stream_failed = true;
                    break;
                }
            }
        }
        drop(file);

        if stream_failed {
            // Keep partial — try the next mirror with Range resume.
            continue;
        }

        // Done — read full buffer and clean up partial.
        let buf = std::fs::read(partial_path).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(partial_path);
        return Ok(buf);
    }

    Err(last_err.unwrap_or_else(|| "all mirrors failed".into()))
}

/// Map a GitHub asset URL through a mirror host. `github.com` keeps the URL as-is.
fn apply_mirror(url: &str, mirror: &str) -> String {
    let m = mirror.trim().trim_end_matches('/');
    if m.is_empty() || m == "github.com" {
        url.to_string()
    } else if m.starts_with("http://") || m.starts_with("https://") {
        format!("{m}/{url}")
    } else {
        format!("https://{m}/{url}")
    }
}

#[tauri::command]
pub async fn download_cpa_update(
    app: AppHandle,
    download_url: String,
    version: String,
    mirrors: Option<Vec<String>>,
) -> Result<(), String> {
    // Refuse to overwrite binaries we don't own. The UI shouldn't reach
    // this codepath for non-managed sources, but defend in depth.
    let settings = app_config::load_settings(&app);
    if !matches!(settings.install_source, InstallSource::Managed) {
        return Err(format!(
            "current install source ({}) is externally managed; use 'External update instructions' instead",
            settings.install_source.kind_label()
        ));
    }

    let client = reqwest::Client::builder()
        .user_agent("CPA-Desktop/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let bin_dir = app_config::bin_dir(&app);
    std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;
    let partial_path = bin_dir.join("download.partial");

    let mirrors = mirrors.unwrap_or_else(|| {
        vec![
            "github.com".to_string(),
            "gh-proxy.com".to_string(),
            "ghproxy.com".to_string(),
        ]
    });

    let buf = download_with_mirrors(&app, &client, &download_url, &mirrors, &partial_path).await?;

    if let Some(cpa_state) = app.try_state::<SharedCpaState>() {
        crate::cpa_manager::kill_cpa(&cpa_state);
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_x64() {
        assert_eq!(
            asset_name_for("v1.2.3", "windows", "x86_64"),
            "CLIProxyAPI_1.2.3_windows_amd64.zip"
        );
    }

    #[test]
    fn macos_arm64_strips_v() {
        assert_eq!(
            asset_name_for("v1.0.0", "macos", "aarch64"),
            "CLIProxyAPI_1.0.0_darwin_arm64.tar.gz"
        );
    }

    #[test]
    fn linux_x64_no_v_prefix() {
        assert_eq!(
            asset_name_for("0.5.0", "linux", "x86_64"),
            "CLIProxyAPI_0.5.0_linux_amd64.tar.gz"
        );
    }

    #[test]
    fn mirror_passthrough_for_github() {
        let url = "https://github.com/x/y/releases/download/v1/file.tar.gz";
        assert_eq!(apply_mirror(url, "github.com"), url);
        assert_eq!(apply_mirror(url, ""), url);
    }

    #[test]
    fn mirror_prepends_proxy_host() {
        let url = "https://github.com/x/y/releases/download/v1/file.tar.gz";
        assert_eq!(
            apply_mirror(url, "gh-proxy.com"),
            "https://gh-proxy.com/https://github.com/x/y/releases/download/v1/file.tar.gz",
        );
        assert_eq!(
            apply_mirror(url, "https://ghproxy.com/"),
            "https://ghproxy.com/https://github.com/x/y/releases/download/v1/file.tar.gz",
        );
    }
}
