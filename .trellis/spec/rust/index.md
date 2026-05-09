# Rust Native Layer Index

Read this before Tauri or Rust work.

## Baseline Modules

```text
src-tauri/src/
  commands/          # Tauri command handlers grouped by domain
  app_config.rs      # app-data paths, settings load/save/migration, config.yaml
  cpa_manager.rs     # process state, spawn/kill chokepoint, status enum
  cpa_lifecycle.rs   # higher-level start/stop/readiness workflow
  install_source.rs  # managed/homebrew/system/custom path resolution
  install_detect.rs  # detection of external installs
  log_stream.rs      # stdout/stderr capture, redaction, ring buffer
  tray.rs            # tray menu and restore/update events
  lib.rs             # Tauri builder, plugins, health monitor
```

## Rules

- Keep commands in `commands/*.rs`; register them in the Tauri invoke handler.
- Keep heavy native logic outside command handlers.
- Keep Rust payloads synchronized with `src/lib/tauri.ts` and `src/types/*`.
- Do not hold locks across `.await`.
- Do not overwrite user-owned files for external install sources.
- Keep subprocess lifecycle changes epoch-safe.
- Keep secrets redacted before logging or emitting to the frontend.
- Treat `config.yaml` as CLIProxyAPI runtime configuration and port source.
- Keep updater, tray, capabilities, and signing changes explicit and tested.

## More Specific Guides

- `cpa-desktop-runtime.md`
- `directory-structure.md`
- `tauri-commands-and-ipc.md`
- `state-and-process-lifecycle.md`
- `app-data-and-configuration.md`
- `security-and-capabilities.md`
- `testing.md`
