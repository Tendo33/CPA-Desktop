//! Detect existing CPA installations on the host.
//!
//! All probing happens off the UI thread and is bounded with strict
//! timeouts so we never block startup. Detection is *advisory*: we
//! return what we find, the user (or UI) decides whether to switch.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::install_source::{binary_filename, InstallSource};

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedInstall {
    pub source: InstallSource,
    /// Free-form note shown next to the candidate in the UI.
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DetectionReport {
    pub managed_present: bool,
    pub homebrew: Option<DetectedInstall>,
    pub system_path: Option<DetectedInstall>,
}

/// Run a command with a hard timeout. Returns stdout on success, or an
/// error string capturing whichever failure mode (spawn / non-zero / stuck).
fn run_capturing(program: &str, args: &[&str], timeout: Duration) -> Result<String, String> {
    use std::process::{Command, Stdio};

    let mut cmd = Command::new(program);
    cmd.args(args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn {program}: {e}"))?;

    // Poll-based timeout. Cheap and dependency-free.
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let mut out = String::new();
                if let Some(mut s) = child.stdout.take() {
                    use std::io::Read;
                    let _ = s.read_to_string(&mut out);
                }
                if !status.success() {
                    return Err(format!("{program} exited with {:?}", status.code()));
                }
                return Ok(out.trim().to_string());
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return Err(format!("{program} timed out"));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("{program} wait: {e}")),
        }
    }
}

/// Try to detect an active Homebrew installation of `cliproxyapi`.
///
/// Strategy:
/// 1. `brew --prefix cliproxyapi` — succeeds only if the formula is installed.
/// 2. Verify the binary exists at `<prefix>/bin/cli-proxy-api`.
pub fn detect_homebrew() -> Option<DetectedInstall> {
    if cfg!(target_os = "windows") {
        return None;
    }
    let prefix = run_capturing("brew", &["--prefix", "cliproxyapi"], PROBE_TIMEOUT).ok()?;
    let prefix = PathBuf::from(prefix);
    let bin = prefix.join("bin").join(binary_filename());
    if !bin.exists() {
        return None;
    }
    Some(DetectedInstall {
        source: InstallSource::Homebrew {
            prefix: prefix.clone(),
        },
        note: Some(format!("brew prefix: {}", prefix.display())),
    })
}

/// Look for `cli-proxy-api` on `$PATH` (system package / install script).
///
/// Skips paths that fall inside Homebrew's prefix to avoid double-counting
/// with [`detect_homebrew`].
pub fn detect_system_path(brew_prefix: Option<&Path>) -> Option<DetectedInstall> {
    let bin_name = binary_filename();
    let path_var = std::env::var_os("PATH")?;
    for entry in std::env::split_paths(&path_var) {
        let candidate = entry.join(bin_name);
        if !candidate.is_file() {
            continue;
        }
        if let Some(bp) = brew_prefix {
            if candidate.starts_with(bp) {
                continue;
            }
        }
        let config = guess_config_path();
        return Some(DetectedInstall {
            source: InstallSource::SystemPath {
                binary: candidate.clone(),
                config: config.clone(),
            },
            note: Some(format!(
                "{} (config: {})",
                candidate.display(),
                config.display()
            )),
        });
    }
    None
}

/// Best-effort guess for an external CPA config path. Order:
/// 1. `$XDG_CONFIG_HOME/cli-proxy-api/config.yaml`
/// 2. `~/.config/cli-proxy-api/config.yaml`
/// 3. `~/.cli-proxy-api/config.yaml` (matches the official quick-start)
fn guess_config_path() -> PathBuf {
    if let Ok(xdg) = std::env::var("XDG_CONFIG_HOME") {
        let p = PathBuf::from(xdg).join("cli-proxy-api").join("config.yaml");
        if p.exists() {
            return p;
        }
    }
    if let Some(home) = home_dir() {
        let xdg = home.join(".config/cli-proxy-api/config.yaml");
        if xdg.exists() {
            return xdg;
        }
        let dot = home.join(".cli-proxy-api/config.yaml");
        return dot;
    }
    PathBuf::from("config.yaml")
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// Run all detectors. Cheap to call; designed for an explicit
/// "Re-detect" button in the UI.
pub fn detect_all(managed_binary: &Path) -> DetectionReport {
    let homebrew = detect_homebrew();
    let brew_prefix = homebrew.as_ref().and_then(|h| match &h.source {
        InstallSource::Homebrew { prefix } => Some(prefix.as_path()),
        _ => None,
    });
    let system_path = detect_system_path(brew_prefix);
    DetectionReport {
        managed_present: managed_binary.exists(),
        homebrew,
        system_path,
    }
}

/// Validate that an `InstallSource` is usable: binary exists & is
/// executable, config is readable YAML with a `port` field, working dir
/// resolves.
///
/// Returns a list of human-readable errors (empty = OK).
pub fn validate(source: &InstallSource, managed_binary: &Path) -> Vec<String> {
    use crate::install_source::{ManagedContext, ResolvedPaths};

    let mut errs = Vec::new();
    let resolved: ResolvedPaths = match source {
        InstallSource::Managed => {
            // Managed is always "valid" at the type level; report empty
            // and let callers handle the "binary not yet downloaded" case
            // separately, since that has a guided first-run UI.
            return errs;
        }
        other => other.resolve(&ManagedContext {
            bin_dir: managed_binary
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_default(),
            data_dir: PathBuf::new(),
        }),
    };

    if !resolved.binary.is_file() {
        errs.push(format!("binary not found: {}", resolved.binary.display()));
    } else {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            match std::fs::metadata(&resolved.binary) {
                Ok(meta) => {
                    let mode = meta.permissions().mode();
                    if mode & 0o111 == 0 {
                        errs.push(format!(
                            "binary is not executable: {}",
                            resolved.binary.display()
                        ));
                    }
                }
                Err(e) => errs.push(format!("cannot read binary metadata: {e}")),
            }
        }
    }

    if !resolved.config.is_file() {
        errs.push(format!(
            "config.yaml not found: {}",
            resolved.config.display()
        ));
    } else {
        match std::fs::read_to_string(&resolved.config) {
            Ok(raw) => match serde_yaml::from_str::<serde_yaml::Value>(&raw) {
                Ok(val) => {
                    if val.get("port").and_then(|v| v.as_u64()).is_none() {
                        errs.push("config.yaml has no numeric `port` field".into());
                    }
                }
                Err(e) => errs.push(format!("config.yaml is not valid YAML: {e}")),
            },
            Err(e) => errs.push(format!("cannot read config.yaml: {e}")),
        }
    }

    if let InstallSource::Custom { working_dir, .. } = source {
        if !working_dir.is_dir() {
            errs.push(format!(
                "working dir is not a directory: {}",
                working_dir.display()
            ));
        }
    }

    errs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_managed_is_no_op() {
        let errs = validate(&InstallSource::Managed, Path::new("/whatever"));
        assert!(errs.is_empty());
    }

    #[test]
    fn validate_custom_flags_missing_paths() {
        let s = InstallSource::Custom {
            binary: PathBuf::from("/no/such/binary"),
            config: PathBuf::from("/no/such/config.yaml"),
            working_dir: PathBuf::from("/no/such/dir"),
        };
        let errs = validate(&s, Path::new("/whatever"));
        assert!(errs.iter().any(|e| e.contains("binary not found")));
        assert!(errs.iter().any(|e| e.contains("config.yaml not found")));
        assert!(errs
            .iter()
            .any(|e| e.contains("working dir is not a directory")));
    }

    #[test]
    fn validate_systempath_with_real_files() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("cli-proxy-api");
        let cfg = tmp.path().join("config.yaml");
        std::fs::write(&bin, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::write(&cfg, "port: 8317\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perm = std::fs::metadata(&bin).unwrap().permissions();
            perm.set_mode(0o755);
            std::fs::set_permissions(&bin, perm).unwrap();
        }
        let s = InstallSource::SystemPath {
            binary: bin,
            config: cfg,
        };
        let errs = validate(&s, Path::new("/whatever"));
        assert!(errs.is_empty(), "unexpected validation errors: {errs:?}");
    }

    #[test]
    fn validate_rejects_yaml_without_port() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("cli-proxy-api");
        let cfg = tmp.path().join("config.yaml");
        std::fs::write(&bin, "stub").unwrap();
        std::fs::write(&cfg, "other: 1\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perm = std::fs::metadata(&bin).unwrap().permissions();
            perm.set_mode(0o755);
            std::fs::set_permissions(&bin, perm).unwrap();
        }
        let s = InstallSource::SystemPath {
            binary: bin,
            config: cfg,
        };
        let errs = validate(&s, Path::new("/whatever"));
        assert!(errs.iter().any(|e| e.contains("no numeric `port`")));
    }

    #[test]
    fn validate_homebrew_accepts_formula_prefix_layout() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let prefix = root.join("opt/cliproxyapi");
        let bin = prefix.join("bin").join("cliproxyapi");
        let cfg = root.join("etc/cliproxyapi.conf");
        std::fs::create_dir_all(bin.parent().unwrap()).unwrap();
        std::fs::create_dir_all(cfg.parent().unwrap()).unwrap();
        std::fs::write(&bin, "#!/bin/sh\nexit 0\n").unwrap();
        std::fs::write(&cfg, "port: 8317\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perm = std::fs::metadata(&bin).unwrap().permissions();
            perm.set_mode(0o755);
            std::fs::set_permissions(&bin, perm).unwrap();
        }
        let s = InstallSource::Homebrew { prefix };
        let errs = validate(&s, Path::new("/managed"));
        assert!(errs.is_empty(), "unexpected validation errors: {errs:?}");
    }

    #[test]
    fn detect_returns_managed_present_flag() {
        let tmp = tempfile::tempdir().unwrap();
        let stub = tmp.path().join(binary_filename());
        let report = detect_all(&stub);
        assert!(!report.managed_present);
        std::fs::write(&stub, b"x").unwrap();
        let report = detect_all(&stub);
        assert!(report.managed_present);
    }
}
