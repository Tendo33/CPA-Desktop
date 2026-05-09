# Code Quality

These rules apply to Rust + Tauri + React desktop repositories.

## Mandatory Rules

- Keep Tauri commands thin; put native behavior in Rust modules that can be unit
  tested without a webview.
- Keep frontend components unaware of raw Tauri `invoke()` strings.
- Keep app-data writes atomic when corrupt or partial files would break launch.
- Keep process lifecycle transitions generation-safe.
- Redact secrets before they enter logs, ring buffers, Tauri events, or UI.
- Do not broaden permissions, CSP, or updater endpoints without a concrete
  product reason.

## Rust

- Use explicit `Result<T, String>` or domain-specific errors at command
  boundaries.
- Use `serde(rename_all = "camelCase")` for structs consumed by TypeScript.
- Use `#[serde(tag = "kind", content = "data")]` for tagged unions consumed by
  TypeScript.
- Keep path resolution and install-source logic testable without `AppHandle`
  where possible.
- Never keep a `MutexGuard` alive across `.await`.

## Frontend

- Keep TypeScript strict.
- Keep Tauri command wrappers, plugin calls, and event payload types in
  `src/lib/tauri.ts`.
- Use stores for cross-page state and event subscriptions; components should
  render state and call typed helpers.
- Keep locale keys aligned across languages.
- Visible UI changes must follow `DESIGN.md` when present.

## Before Handoff

Run the smallest Rust and frontend checks that cover the change. For native
process/config/IPC work, include Rust tests and frontend type checks at minimum.
