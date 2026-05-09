# Project Overview

CPA Desktop is a cross-platform desktop app for CLIProxyAPI. It downloads,
configures, starts, stops, updates, and monitors CPA while exposing the
management web UI inside a native Tauri webview.

## Current Product Surface

- First-run setup wizard for managed binary download and configuration.
- Dashboard with embedded CPA management panel and auth recovery overlay.
- Logs page streaming CPA stdout/stderr.
- Settings page for install source, config, process behavior, and preferences.
- Auth files page for management credentials.
- System tray, updater, signing/release pipeline, and cross-platform installers.

## Important Boundaries

- Rust native code owns process management, app-data files, updater, and Tauri
  command handlers.
- React UI owns shell, pages, stores, i18n, and display state.
- `src/lib/tauri.ts` is the only raw IPC/plugin boundary for frontend code.
- User-owned external install sources must not be mutated by managed-source
  logic.
- Security docs under `docs/SECURITY.md` and signing notes under
  `docs/SIGNING.md` remain supporting maintainer docs.
