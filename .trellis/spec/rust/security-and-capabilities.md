# Security And Capabilities

Use this before touching Tauri permissions, CSP, updater, file access, subprocess
launch, logs, or diagnostics.

## Capability Rules

- Keep filesystem access narrowed to app-owned directories such as `$APPDATA`,
  `$APPLOG`, and `$APPCONFIG`.
- Add plugin permissions only for a feature that uses the plugin.
- Do not allow arbitrary shell execution from the frontend.
- Validate custom paths on the Rust side before using them.

## CSP Rules

- Keep `default-src 'self'`.
- Add `connect-src`, `img-src`, `font-src`, or script/style exceptions only when
  a real runtime resource requires them.
- Explain why any `unsafe-*` source is required before broadening it further.
- Re-test the Tauri build after CSP changes.

## Log And Diagnostic Rules

- Redact API keys, bearer tokens, passwords, secrets, and auth headers before
  writing to a ring buffer or emitting to the frontend.
- Do not include raw config files in frontend error events.
- Diagnostics should write app-owned logs or open app-owned folders.

## Updater Rules

- Keep updater endpoints pinned to the expected release location.
- Keep public keys and signing metadata in Tauri config, not app code.
- Version changes must stay synchronized across `package.json`,
  `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.

## Review Checklist

- [ ] Did the capability change grant only the minimum required permission?
- [ ] Did the CSP change name the exact remote/local resource it enables?
- [ ] Are secrets redacted before logs/events/UI?
- [ ] Are custom paths validated and user-owned files protected?
- [ ] Was a desktop build or targeted native check run?
