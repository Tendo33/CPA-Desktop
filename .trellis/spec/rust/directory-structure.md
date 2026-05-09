# Rust Directory Structure

Use the existing `src-tauri/src/` module layout before creating new modules.

## Expected Layout

```text
src-tauri/
  Cargo.toml
  tauri.conf.json
  capabilities/default.json
  src/
    commands/
      cpa.rs
      config.rs
      install.rs
      updater.rs
      diag.rs
      auth_files.rs
      mod.rs
    app_config.rs
    cpa_lifecycle.rs
    cpa_manager.rs
    install_detect.rs
    install_source.rs
    lib.rs
    log_stream.rs
    tray.rs
    util/
```

## Placement Rules

- Add Tauri command handlers to `commands/<domain>.rs`.
- Add process spawn, kill, and status logic to `cpa_manager.rs` or a dedicated
  lifecycle module, not directly in commands.
- Add app-data path, settings, and config.yaml behavior to `app_config.rs`.
- Add install-source resolution to `install_source.rs`; keep detection in
  `install_detect.rs`.
- Add reusable platform/process helpers under `util/`.
- Add integration tests under `src-tauri/tests/` when behavior needs a fixture
  binary, temp directory, or platform-specific process behavior.

## Anti-Patterns

- Do not put frontend-specific behavior in Rust modules.
- Do not put subprocess lifecycle rules in command handlers.
- Do not add a new top-level module when an existing domain module owns the
  behavior.
- Do not read or write arbitrary user paths from app code without an explicit
  capability and validation story.
