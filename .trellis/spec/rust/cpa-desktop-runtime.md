# CPA Desktop Runtime

CPA Desktop manages the CLIProxyAPI binary and local app state from a Tauri v2
native layer.

## Native Modules

- `app_config.rs`: `AppSettings`, app-data paths, settings migration,
  `config.yaml` bootstrap, atomic writes, corrupt-file quarantine.
- `cpa_manager.rs`: `CpaState`, `CpaStatus`, `spawn_cpa`, and
  `kill_cpa_at_epoch`; this is the start/stop chokepoint.
- `cpa_lifecycle.rs`: start/stop orchestration, path resolution, readiness
  watcher, and handoff to the health monitor.
- `log_stream.rs`: stdout/stderr capture, port-in-use detection, and frontend
  event streaming.
- `install_source.rs`: Managed, Homebrew, SystemPath, and Custom path and update
  strategy resolution.
- `install_detect.rs`: Homebrew/system-path/config auto-detection and validation.
- `commands/*`: Tauri command handlers for CPA, config, install, updater,
  diagnostics, and auth files.
- `lib.rs`: Tauri builder/plugin registration, loopback probes, and epoch-safe
  health monitor.

## Process And State Invariants

- Every successful `spawn_cpa` increments `CpaState.epoch`.
- Any delayed watcher, health monitor, log task, or stop request must check the
  expected epoch before mutating process state.
- `CpaStatus` serializes as a tagged union shared with `src/types/cpa.ts`.
- `config.yaml` is the authoritative CPA port source; startup syncs mismatches
  back to `app-settings.json`.
- Settings writes must remain atomic and corrupt settings should be quarantined
  instead of crashing startup.

## Install Sources And Security

- Managed source owns `<appData>/bin/cli-proxy-api` and
  `<appData>/data/config.yaml`.
- Homebrew, SystemPath, and Custom sources are user-owned; do not overwrite their
  binaries or config files.
- Management `secret-key` and `api-keys` live in `config.yaml`; never log or emit
  secrets casually.
- Tauri capabilities, filesystem permissions, updater endpoints, and CSP should
  only broaden for a concrete feature and must be reviewed with security docs.
