use crate::app_config;
use crate::cpa_manager::SharedCpaState;
use crate::install_source::{InstallSource, UpdateStrategy};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: Option<String>,
    pub latest_version: String,
    pub update_available: bool,
    pub download_url: String,
    /// SHA256 of the asset, lowercase hex. Optional because legacy
    /// releases didn't ship checksum files; when absent we fall back to
    /// "best effort" download with no integrity verification.
    pub expected_sha256: Option<String>,
    /// What the UI should do when the user clicks "Update". Mirrors
    /// `InstallSource::update_strategy()`.
    pub strategy: UpdateStrategy,
}

/// Build a long-timeout client for binary downloads. Distinct from the
/// 2-second `crate::http_client` used for liveness probes — a 14 MB
/// binary over `gh-proxy.com` from a slow connection can easily take a
/// few minutes, but we still want a generous *connect* timeout so a
/// dead mirror gets retried promptly.
fn download_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(format!("CPA-Desktop/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(15 * 60))
        .build()
        .expect("download client")
}

/// Compare two version strings with semver semantics, falling back to
/// string inequality when either side isn't parseable. The leading `v`
/// is stripped before parsing.
fn newer_than(latest: &str, current: Option<&str>) -> bool {
    let cur = match current {
        Some(c) => c,
        None => return true,
    };
    let lhs = latest.trim_start_matches('v');
    let rhs = cur.trim_start_matches('v');
    match (semver::Version::parse(lhs), semver::Version::parse(rhs)) {
        (Ok(a), Ok(b)) => a > b,
        _ => latest != cur,
    }
}

fn effective_current_version(
    settings_version: Option<String>,
    detected_binary_version: Option<String>,
) -> Option<String> {
    detected_binary_version.or(settings_version)
}

fn detect_binary_version(binary_path: &Path) -> Option<String> {
    if !binary_path.exists() {
        return None;
    }
    let output = std::process::Command::new(binary_path)
        .arg("--version")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    parse_version_from_text(&String::from_utf8_lossy(&output.stdout))
        .or_else(|| parse_version_from_text(&String::from_utf8_lossy(&output.stderr)))
}

fn parse_version_from_text(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|part| {
            let trimmed = part.trim_start_matches('v');
            semver::Version::parse(trimmed).is_ok()
        })
        .map(|part| {
            part.trim_matches(|c: char| c == ',' || c == ';')
                .to_string()
        })
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

    let client = download_client();

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

    // Look for a matching `*.sha256` asset OR a `checksums.txt` listing.
    let expected_sha256 = find_expected_sha256(&client, &release, &name).await;

    let detected = if matches!(settings.install_source, InstallSource::Managed) {
        detect_binary_version(&app_config::cpa_binary_path(&app))
    } else {
        None
    };
    let current = effective_current_version(settings.cpa_version.clone(), detected);
    let update_available = newer_than(&release.tag_name, current.as_deref());

    Ok(UpdateCheckResult {
        current_version: current,
        latest_version: release.tag_name,
        update_available,
        download_url: asset.browser_download_url.clone(),
        expected_sha256,
        strategy: settings.install_source.update_strategy(),
    })
}

/// Probe the release for a checksum we can validate the download
/// against. Tries `<asset>.sha256` first, then a sibling
/// `checksums.txt` / `SHA256SUMS` file. Returns `None` when neither is
/// available — the caller falls back to "no integrity check" and logs
/// a warning rather than refusing the download outright.
async fn find_expected_sha256(
    client: &reqwest::Client,
    release: &GhRelease,
    asset_name: &str,
) -> Option<String> {
    let direct_name = format!("{asset_name}.sha256");
    if let Some(direct) = release.assets.iter().find(|a| a.name == direct_name) {
        if let Ok(text) = client
            .get(&direct.browser_download_url)
            .send()
            .await
            .ok()?
            .text()
            .await
        {
            return parse_first_sha256_token(&text);
        }
    }
    for candidate in ["checksums.txt", "SHA256SUMS", "sha256sums.txt"] {
        if let Some(asset) = release.assets.iter().find(|a| a.name == candidate) {
            if let Ok(text) = client
                .get(&asset.browser_download_url)
                .send()
                .await
                .ok()?
                .text()
                .await
            {
                return parse_sha256_for(&text, asset_name);
            }
        }
    }
    None
}

fn parse_first_sha256_token(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|t| t.len() == 64 && t.chars().all(|c| c.is_ascii_hexdigit()))
        .map(|s| s.to_ascii_lowercase())
}

/// Parse a `sha256sum`-style file looking for the line whose filename
/// column matches `asset_name` exactly. Strict equality avoids matching
/// sibling files like `<asset>.sig` / `<asset>.asc` whose checksum
/// would otherwise be returned and trigger a false "checksum mismatch".
fn parse_sha256_for(text: &str, asset_name: &str) -> Option<String> {
    for line in text.lines() {
        // Lines look like:  <hex sha>[ \t]+[*]?<filename>
        let mut parts = line.split_whitespace();
        let sha = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        if sha.len() == 64 && sha.chars().all(|c| c.is_ascii_hexdigit()) && name == asset_name {
            return Some(sha.to_ascii_lowercase());
        }
    }
    None
}

async fn download_with_mirrors(
    app: &AppHandle,
    client: &reqwest::Client,
    original_url: &str,
    mirrors: &[String],
    partial_path: &std::path::Path,
) -> Result<PathBuf, String> {
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

        // Done. Keep the file on disk so checksum and extraction can stream it.
        return Ok(partial_path.to_path_buf());
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
    expected_sha256: Option<String>,
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

    let client = download_client();

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

    let downloaded_path =
        download_with_mirrors(&app, &client, &download_url, &mirrors, &partial_path).await?;

    // Integrity check before we touch anything on disk.
    if let Some(expected) = expected_sha256.as_deref() {
        let got = match sha256_hex_file(&downloaded_path) {
            Ok(g) => g,
            Err(e) => {
                let _ = std::fs::remove_file(&downloaded_path);
                return Err(e);
            }
        };
        if !got.eq_ignore_ascii_case(expected) {
            let _ = std::fs::remove_file(&downloaded_path);
            return Err(format!(
                "checksum mismatch: expected {expected}, got {got} (download discarded)"
            ));
        }
    } else {
        log::warn!("no SHA256 available for {download_url}; skipping integrity check");
    }

    let binary_name = if cfg!(target_os = "windows") {
        "cli-proxy-api.exe"
    } else {
        "cli-proxy-api"
    };

    // Extract into a tempfile *first*, then atomically swap the live
    // binary. This way a corrupted/half-written extraction never
    // replaces a working install.
    let staging = bin_dir.join(format!("{binary_name}.new"));
    let _ = std::fs::remove_file(&staging);
    let extract_res = if download_url.ends_with(".zip") {
        extract_zip_to(&downloaded_path, binary_name, &staging)
    } else {
        extract_targz_to(&downloaded_path, binary_name, &staging)
    };
    if let Err(e) = extract_res {
        let _ = std::fs::remove_file(&downloaded_path);
        return Err(e);
    }
    let _ = std::fs::remove_file(&downloaded_path);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&staging)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&staging, perms).map_err(|e| e.to_string())?;
    }

    // Stop the running CPA before swapping the file (Windows holds an
    // exclusive lock on a running .exe; Unix is fine but stopping is
    // still the right behaviour because the user will want a restart).
    if let Some(cpa_state) = app.try_state::<SharedCpaState>() {
        crate::cpa_manager::kill_cpa(&cpa_state);
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }

    let live = bin_dir.join(binary_name);

    // POSIX rename() atomically replaces an existing file, so we don't
    // need a backup dance. Windows can't replace a file currently held
    // open by a process *we* don't own (rare here since we just killed
    // CPA), but for safety we still snapshot to `.old` and roll back
    // when the swap fails.
    #[cfg(target_os = "windows")]
    let backup = {
        let b = bin_dir.join(format!("{binary_name}.old"));
        if live.exists() {
            let _ = std::fs::remove_file(&b);
            if let Err(e) = std::fs::rename(&live, &b) {
                let _ = std::fs::remove_file(&staging);
                return Err(format!("failed to snapshot live binary: {e}"));
            }
        }
        b
    };

    if let Err(e) = std::fs::rename(&staging, &live) {
        // Best-effort rollback: if we just renamed the old binary to
        // `.old`, restore it so the user is left with a *working* CPA
        // rather than no binary at all.
        #[cfg(target_os = "windows")]
        {
            if backup.exists() {
                if let Err(re) = std::fs::rename(&backup, &live) {
                    log::error!(
                        "rollback failed after swap error: {re}. Manual recovery: \
                         move {} back to {}",
                        backup.display(),
                        live.display()
                    );
                }
            }
        }
        let _ = std::fs::remove_file(&staging);
        return Err(format!("failed to swap binary: {e}"));
    }

    let mut settings = app_config::load_settings(&app);
    settings.cpa_version = Some(version);
    app_config::save_settings(&app, &settings)?;

    let _ = app.emit("cpa:download-complete", ());
    Ok(())
}

#[cfg(test)]
fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

fn sha256_hex_file(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;

    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

fn atomic_copy_reader_to_path<R: std::io::Read>(
    mut reader: R,
    out_path: &Path,
) -> Result<(), String> {
    use std::io::Write;

    let parent = out_path
        .parent()
        .ok_or_else(|| "destination has no parent".to_string())?;
    let tmp = parent.join(format!(
        ".{}.tmp",
        out_path
            .file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_else(|| "download".into())
    ));
    let result = (|| {
        let mut out = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        std::io::copy(&mut reader, &mut out).map_err(|e| e.to_string())?;
        out.flush().map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, out_path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// Extract `binary_name` from `data` into `out_path` exactly. Caller
/// chooses the destination path so we can stage to `<binary>.new` and
/// atomically swap.
fn extract_zip_to(archive_path: &Path, binary_name: &str, out_path: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let file_name = std::path::Path::new(file.name())
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        if file_name == binary_name {
            atomic_copy_reader_to_path(&mut file, out_path)?;
            return Ok(());
        }
    }
    Err(format!("{binary_name} not found in zip"))
}

fn extract_targz_to(archive_path: &Path, binary_name: &str, out_path: &Path) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use tar::Archive;

    let file = std::fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let gz = GzDecoder::new(file);
    let mut archive = Archive::new(gz);

    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?;
        let file_name = path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        if file_name == binary_name {
            atomic_copy_reader_to_path(&mut entry, out_path)?;
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
    fn semver_compare_picks_newer_patch() {
        assert!(newer_than("v1.2.4", Some("v1.2.3")));
        assert!(!newer_than("v1.2.3", Some("v1.2.3")));
        assert!(!newer_than("v1.2.3", Some("v1.2.4")));
    }

    #[test]
    fn semver_strips_v_prefix() {
        assert!(newer_than("v1.10.0", Some("1.9.999")));
    }

    #[test]
    fn semver_handles_missing_current() {
        assert!(newer_than("v1.0.0", None));
    }

    #[test]
    fn detected_binary_version_overrides_stale_settings_version() {
        let current = effective_current_version(Some("v1.2.0".into()), Some("v1.3.0".into()));
        assert_eq!(current.as_deref(), Some("v1.3.0"));
        assert!(!newer_than("v1.3.0", current.as_deref()));
    }

    #[test]
    fn settings_version_is_used_when_binary_version_is_unknown() {
        let current = effective_current_version(Some("v1.2.0".into()), None);
        assert_eq!(current.as_deref(), Some("v1.2.0"));
    }

    #[test]
    fn sha256_hex_file_matches_in_memory_hash() {
        let tmp = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(tmp.path(), b"hello from disk").unwrap();

        assert_eq!(
            sha256_hex_file(tmp.path()).unwrap(),
            sha256_hex(b"hello from disk")
        );
    }

    #[test]
    fn parse_sha256_from_checksums_txt() {
        let text = "abcd  irrelevant\n\
                    deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  CLIProxyAPI_1.2.3_linux_amd64.tar.gz\n";
        let s = parse_sha256_for(text, "CLIProxyAPI_1.2.3_linux_amd64.tar.gz").unwrap();
        assert_eq!(s.len(), 64);
        assert!(s.starts_with("deadbeef"));
    }

    #[test]
    fn parse_sha256_does_not_match_signature_sibling() {
        let text = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  CLIProxyAPI_1.2.3_linux_amd64.tar.gz.sig\n\
                    cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe  CLIProxyAPI_1.2.3_linux_amd64.tar.gz\n\
                    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  CLIProxyAPI_1.2.3_linux_amd64.tar.gz.asc\n";
        let s = parse_sha256_for(text, "CLIProxyAPI_1.2.3_linux_amd64.tar.gz").unwrap();
        assert!(s.starts_with("cafebabe"), "matched wrong line: {s}");
    }

    #[test]
    fn parse_sha256_handles_binary_mode_star_prefix() {
        let text = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef *asset.tgz\n";
        let s = parse_sha256_for(text, "asset.tgz").unwrap();
        assert_eq!(s.len(), 64);
    }

    #[test]
    fn parse_sha256_returns_none_when_no_match() {
        let text = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  other.tgz\n";
        assert!(parse_sha256_for(text, "asset.tgz").is_none());
    }

    #[test]
    fn parse_sha256_from_single_line_file() {
        let text = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  asset.tgz\n";
        assert!(parse_first_sha256_token(text).is_some());
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
