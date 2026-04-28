//! Install source abstraction.
//!
//! CPA can be installed in several ways (managed by us, via Homebrew,
//! via a Linux package manager, or in a fully custom location). This module
//! captures that as a single enum and exposes path / update-strategy
//! resolution that the rest of the app depends on.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InstallSource {
    /// Managed by CPA Desktop: we download, replace, and run the binary
    /// out of the app data directory. This is the original behaviour and
    /// remains the default.
    Managed,

    /// Installed via Homebrew. `prefix` is the brew prefix
    /// (typically `/opt/homebrew` on Apple Silicon, `/usr/local` on Intel).
    Homebrew { prefix: PathBuf },

    /// Installed via a system package manager / one-shot install script
    /// (Arch AUR, Debian/Ubuntu installer, etc.) — anything where the
    /// binary is already on `$PATH` but we don't own it.
    SystemPath { binary: PathBuf, config: PathBuf },

    /// Fully user-specified paths.
    Custom {
        binary: PathBuf,
        config: PathBuf,
        working_dir: PathBuf,
    },
}

impl Default for InstallSource {
    fn default() -> Self {
        InstallSource::Managed
    }
}

/// What kind of "update" makes sense for an install source.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UpdateStrategy {
    /// Download the appropriate GitHub release asset, replace the binary,
    /// then restart. Owned by the desktop app.
    GithubRelease,
    /// Shell out to `brew upgrade cliproxyapi` and stream output back.
    BrewUpgrade,
    /// Show the user instructions; we don't touch their files.
    ExternalNotice,
}

/// Resolved on-disk paths for a given install source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPaths {
    pub binary: PathBuf,
    pub config: PathBuf,
    pub working_dir: PathBuf,
}

/// Free-form context required to resolve `InstallSource::Managed` to
/// concrete paths. We avoid taking an `AppHandle` directly so this module
/// stays unit-testable.
#[derive(Debug, Clone)]
pub struct ManagedContext {
    pub bin_dir: PathBuf,
    pub data_dir: PathBuf,
}

/// Platform-specific filename for the CPA executable. Centralised here
/// so detection / resolution / commands all agree.
pub fn binary_filename() -> &'static str {
    if cfg!(target_os = "windows") {
        "cli-proxy-api.exe"
    } else {
        "cli-proxy-api"
    }
}

impl InstallSource {
    pub fn resolve(&self, managed: &ManagedContext) -> ResolvedPaths {
        match self {
            InstallSource::Managed => ResolvedPaths {
                binary: managed.bin_dir.join(binary_filename()),
                config: managed.data_dir.join("config.yaml"),
                working_dir: managed.data_dir.clone(),
            },
            InstallSource::Homebrew { prefix } => {
                // We deliberately do NOT use `{prefix}/var/cliproxyapi` as
                // the working directory: on Intel Macs `/usr/local` is
                // root-owned and CPA would crash trying to write state
                // files. Our app's internal data dir is always
                // user-writable and survives brew uninstall/reinstall.
                ResolvedPaths {
                    binary: prefix.join("bin").join(binary_filename()),
                    config: prefix.join("etc").join("cliproxyapi.conf"),
                    working_dir: managed.data_dir.clone(),
                }
            }
            InstallSource::SystemPath { binary, config } => {
                let working_dir = config
                    .parent()
                    .map(|p| p.to_path_buf())
                    .unwrap_or_else(|| {
                        binary
                            .parent()
                            .map(|p| p.to_path_buf())
                            .unwrap_or_else(|| PathBuf::from("."))
                    });
                ResolvedPaths {
                    binary: binary.clone(),
                    config: config.clone(),
                    working_dir,
                }
            }
            InstallSource::Custom {
                binary,
                config,
                working_dir,
            } => ResolvedPaths {
                binary: binary.clone(),
                config: config.clone(),
                working_dir: working_dir.clone(),
            },
        }
    }

    pub fn update_strategy(&self) -> UpdateStrategy {
        match self {
            InstallSource::Managed => UpdateStrategy::GithubRelease,
            InstallSource::Homebrew { .. } => UpdateStrategy::BrewUpgrade,
            InstallSource::SystemPath { .. } | InstallSource::Custom { .. } => {
                UpdateStrategy::ExternalNotice
            }
        }
    }

    pub fn kind_label(&self) -> &'static str {
        match self {
            InstallSource::Managed => "managed",
            InstallSource::Homebrew { .. } => "homebrew",
            InstallSource::SystemPath { .. } => "systemPath",
            InstallSource::Custom { .. } => "custom",
        }
    }

    /// Whether the desktop app should treat this as an external process
    /// it merely supervises (i.e. don't replace the binary on update).
    pub fn is_external(&self) -> bool {
        !matches!(self, InstallSource::Managed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> ManagedContext {
        ManagedContext {
            bin_dir: PathBuf::from("/data/bin"),
            data_dir: PathBuf::from("/data/data"),
        }
    }

    #[test]
    fn managed_paths_use_app_data() {
        let r = InstallSource::Managed.resolve(&ctx());
        assert!(r.binary.starts_with("/data/bin"));
        assert_eq!(r.config, PathBuf::from("/data/data/config.yaml"));
        assert_eq!(r.working_dir, PathBuf::from("/data/data"));
    }

    #[test]
    fn homebrew_paths_follow_brew_layout() {
        let s = InstallSource::Homebrew {
            prefix: PathBuf::from("/opt/homebrew"),
        };
        let r = s.resolve(&ctx());
        assert!(r.binary.starts_with("/opt/homebrew/bin"));
        assert_eq!(
            r.config,
            PathBuf::from("/opt/homebrew/etc/cliproxyapi.conf")
        );
        // Working dir is our internal data dir, NOT brew's var/, so the
        // child process always has a writable cwd.
        assert_eq!(r.working_dir, PathBuf::from("/data/data"));
    }

    #[test]
    fn system_path_working_dir_falls_back_to_config_parent() {
        let s = InstallSource::SystemPath {
            binary: PathBuf::from("/usr/bin/cli-proxy-api"),
            config: PathBuf::from("/home/u/.cli-proxy-api/config.yaml"),
        };
        let r = s.resolve(&ctx());
        assert_eq!(r.binary, PathBuf::from("/usr/bin/cli-proxy-api"));
        assert_eq!(
            r.working_dir,
            PathBuf::from("/home/u/.cli-proxy-api")
        );
    }

    #[test]
    fn custom_uses_user_paths_verbatim() {
        let s = InstallSource::Custom {
            binary: PathBuf::from("/x/cpa"),
            config: PathBuf::from("/y/cpa.yaml"),
            working_dir: PathBuf::from("/z"),
        };
        let r = s.resolve(&ctx());
        assert_eq!(r.binary, PathBuf::from("/x/cpa"));
        assert_eq!(r.config, PathBuf::from("/y/cpa.yaml"));
        assert_eq!(r.working_dir, PathBuf::from("/z"));
    }

    #[test]
    fn update_strategy_per_source() {
        assert_eq!(
            InstallSource::Managed.update_strategy(),
            UpdateStrategy::GithubRelease
        );
        assert_eq!(
            InstallSource::Homebrew {
                prefix: "/opt/homebrew".into(),
            }
            .update_strategy(),
            UpdateStrategy::BrewUpgrade
        );
        assert_eq!(
            InstallSource::SystemPath {
                binary: "/usr/bin/cli-proxy-api".into(),
                config: "/c.yaml".into(),
            }
            .update_strategy(),
            UpdateStrategy::ExternalNotice
        );
    }

    #[test]
    fn default_is_managed() {
        assert_eq!(InstallSource::default(), InstallSource::Managed);
    }

    #[test]
    fn serde_tag_layout_is_kind_field() {
        let s = InstallSource::Managed;
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(json, "{\"kind\":\"managed\"}");
        let parsed: InstallSource = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, InstallSource::Managed);
    }

    #[test]
    fn serde_homebrew_carries_prefix() {
        let s = InstallSource::Homebrew {
            prefix: PathBuf::from("/opt/homebrew"),
        };
        let json = serde_json::to_string(&s).unwrap();
        let parsed: InstallSource = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, s);
    }

    #[test]
    fn legacy_settings_without_install_source_default_to_managed() {
        // Mirrors the AppSettings deserialization: missing field → default.
        #[derive(Deserialize)]
        struct Wrap {
            #[serde(default)]
            install_source: InstallSource,
        }
        let w: Wrap = serde_json::from_str("{}").unwrap();
        assert_eq!(w.install_source, InstallSource::Managed);
    }

    #[test]
    fn external_flag_matches_kind() {
        assert!(!InstallSource::Managed.is_external());
        assert!(InstallSource::Homebrew {
            prefix: "/opt/homebrew".into(),
        }
        .is_external());
    }
}
