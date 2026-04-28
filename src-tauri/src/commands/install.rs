//! Tauri commands for managing the active install source.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::app_config;
use crate::cpa_manager::SharedCpaState;
use crate::install_detect::{self, DetectionReport};
use crate::install_source::{InstallSource, ResolvedPaths, UpdateStrategy};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSourceInfo {
    pub source: InstallSource,
    pub paths: ResolvedPaths,
    pub strategy: UpdateStrategy,
    pub validation_errors: Vec<String>,
}

#[tauri::command]
pub fn get_install_source_info(app: AppHandle) -> InstallSourceInfo {
    let settings = app_config::load_settings(&app);
    let paths = app_config::resolve_paths(&app);
    let strategy = settings.install_source.update_strategy();
    let validation_errors = install_detect::validate(&settings.install_source, &paths.binary);
    InstallSourceInfo {
        source: settings.install_source,
        paths,
        strategy,
        validation_errors,
    }
}

#[tauri::command]
pub fn detect_install_sources(app: AppHandle) -> DetectionReport {
    let bin = app_config::bin_dir(&app).join(crate::install_source::binary_filename());
    install_detect::detect_all(&bin)
}

#[tauri::command]
pub fn validate_install_source(app: AppHandle, source: InstallSource) -> Vec<String> {
    let bin = app_config::bin_dir(&app).join(crate::install_source::binary_filename());
    install_detect::validate(&source, &bin)
}

/// Switch the active install source.
///
/// Order matters here: we want to leave the system in a consistent state
/// even if a step fails, so we
///   1. validate the new source,
///   2. compute the new settings (source + port from the candidate's
///      config.yaml) entirely in memory,
///   3. persist them in a single `save_settings` call,
///   4. only then kill the running CPA (which still points at the old
///      binary) and update the in-memory port,
///   5. emit `install:source-changed`.
///
/// If step 3 fails the caller's CPA keeps running, the settings file is
/// untouched, and the user can try again. Frontend is expected to call
/// `start_cpa` afterwards.
#[tauri::command]
pub fn set_install_source(app: AppHandle, source: InstallSource) -> Result<(), String> {
    let bin = app_config::bin_dir(&app).join(crate::install_source::binary_filename());
    let errs = install_detect::validate(&source, &bin);
    if !errs.is_empty() {
        return Err(errs.join("; "));
    }

    let mut settings = app_config::load_settings(&app);

    // Resolve the *candidate* paths (without persisting yet) so we can
    // pull the port from the new config.yaml in the same atomic write.
    let managed = crate::install_source::ManagedContext {
        bin_dir: app_config::bin_dir(&app),
        data_dir: app_config::internal_data_dir(&app),
    };
    let candidate_paths = source.resolve(&managed);

    settings.install_source = source;
    let candidate_port = app_config::read_port_from_path(&candidate_paths.config).ok();
    if let Some(p) = candidate_port {
        settings.port = p;
    }

    app_config::save_settings(&app, &settings)?;

    if let Some(state) = app.try_state::<SharedCpaState>() {
        crate::cpa_manager::kill_cpa(&state);
        if let Some(p) = candidate_port {
            state.lock().unwrap().port = p;
        }
    }

    let _ = app.emit(
        "install:source-changed",
        get_install_source_info(app.clone()),
    );

    Ok(())
}

/* ── Brew upgrade ─────────────────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrewUpgradeResult {
    pub success: bool,
    pub log: String,
}

/// Run `brew update && brew upgrade cliproxyapi`, streaming each line back
/// to the frontend via `install:brew-line` events. Bounded by a 30-minute
/// hard timeout so we never deadlock the UI.
///
/// `run_streaming` is purely blocking (poll + `std::thread::sleep`), so we
/// hand it off to `spawn_blocking`. Otherwise it would tie up a Tokio
/// worker for the entire upgrade and block other commands.
#[tauri::command]
pub async fn upgrade_via_brew(app: AppHandle) -> Result<BrewUpgradeResult, String> {
    let settings = app_config::load_settings(&app);
    if !matches!(settings.install_source, InstallSource::Homebrew { .. }) {
        return Err("install source is not Homebrew".into());
    }

    if let Some(state) = app.try_state::<SharedCpaState>() {
        crate::cpa_manager::kill_cpa(&state);
    }

    let app_for_blocking = app.clone();
    let result = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let mut log = String::new();
        let app_for_emit = app_for_blocking.clone();
        let emit = move |line: &str| {
            let _ = app_for_emit.emit("install:brew-line", line.to_string());
        };

        let timeout = std::time::Duration::from_secs(30 * 60);
        run_streaming("brew", &["update"], timeout, &mut log, &emit).map_err(|e| {
            log.push_str(&format!("\nbrew update failed: {e}"));
            log.clone()
        })?;
        run_streaming(
            "brew",
            &["upgrade", "cliproxyapi"],
            timeout,
            &mut log,
            &emit,
        )
        .map_err(|e| {
            log.push_str(&format!("\nbrew upgrade failed: {e}"));
            log.clone()
        })?;
        Ok(log)
    })
    .await
    .map_err(|e| format!("brew task join error: {e}"))?;

    let log = result?;
    let _ = app.emit("install:brew-complete", ());
    Ok(BrewUpgradeResult { success: true, log })
}

fn run_streaming(
    program: &str,
    args: &[&str],
    timeout: std::time::Duration,
    accumulator: &mut String,
    emit: &impl Fn(&str),
) -> Result<(), String> {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};

    let mut cmd = Command::new(program);
    cmd.args(args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let header = format!("$ {} {}\n", program, args.join(" "));
    accumulator.push_str(&header);
    emit(header.trim_end());

    let mut child = cmd.spawn().map_err(|e| format!("spawn {program}: {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    // Spawn line readers on dedicated threads so we don't deadlock when
    // both streams have output but only one is being polled.
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let tx_o = tx.clone();
    let h_out = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = tx_o.send(line);
        }
    });
    let h_err = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = tx.send(line);
        }
    });

    let drain = |accumulator: &mut String| {
        while let Ok(line) = rx.try_recv() {
            accumulator.push_str(&line);
            accumulator.push('\n');
            emit(&line);
        }
    };

    let start = std::time::Instant::now();
    let exit_status = loop {
        drain(accumulator);
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    // Wait for reader threads to observe the closed pipes
                    // so we can flush whatever they buffered before
                    // returning the timeout error.
                    let _ = h_out.join();
                    let _ = h_err.join();
                    drain(accumulator);
                    return Err("timed out".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => return Err(format!("wait: {e}")),
        }
    };

    // Child has exited — pipes will close; join the readers before the
    // final drain so no trailing lines are lost.
    let _ = h_out.join();
    let _ = h_err.join();
    drain(accumulator);

    if !exit_status.success() {
        return Err(format!("exit code {:?}", exit_status.code()));
    }
    Ok(())
}

/* ── External-update notice (SystemPath / Custom) ──────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalUpdateInstructions {
    pub heading: String,
    pub commands: Vec<String>,
    pub link: Option<String>,
}

#[tauri::command]
pub fn external_update_instructions(app: AppHandle) -> ExternalUpdateInstructions {
    let settings = app_config::load_settings(&app);
    match settings.install_source {
        InstallSource::SystemPath { .. } => ExternalUpdateInstructions {
            heading: "Update via your system package manager".into(),
            commands: vec![
                "# Arch (AUR)".into(),
                "paru -Syu cli-proxy-api-bin".into(),
                "# or yay -Syu cli-proxy-api-bin".into(),
                "".into(),
                "# Linux installer script".into(),
                "curl -fsSL https://raw.githubusercontent.com/brokechubb/cliproxyapi-installer/refs/heads/master/cliproxyapi-installer | bash".into(),
            ],
            link: Some(
                "https://help.router-for.me/cn/introduction/quick-start.html".into(),
            ),
        },
        InstallSource::Custom { .. } => ExternalUpdateInstructions {
            heading: "Update your custom install manually".into(),
            commands: vec![
                "# Replace the binary at the path you configured.".into(),
                "# Keep config.yaml compatible with the new version.".into(),
            ],
            link: Some(
                "https://github.com/router-for-me/CLIProxyAPI/releases/latest".into(),
            ),
        },
        InstallSource::Homebrew { .. } => ExternalUpdateInstructions {
            heading: "Update via Homebrew".into(),
            commands: vec![
                "brew update".into(),
                "brew upgrade cliproxyapi".into(),
            ],
            link: Some(
                "https://help.router-for.me/cn/introduction/quick-start.html".into(),
            ),
        },
        InstallSource::Managed => ExternalUpdateInstructions {
            heading: "Use 'Check for Updates' in the app".into(),
            commands: vec![],
            link: None,
        },
    }
}
