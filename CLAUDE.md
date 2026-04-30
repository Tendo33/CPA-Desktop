# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CPA Desktop is a cross-platform desktop app (Tauri v2 + Rust + React) that manages the [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) binary — downloading it, launching it as a subprocess, streaming its logs, and exposing its management web UI in a native webview.

## Commands

```bash
# Dev
npm install
npm run tauri dev        # full app (Rust + frontend hot reload)
npm run dev              # frontend only (no Tauri IPC)

# Build
npm run tauri build      # produces installers in src-tauri/target/release/bundle/

# Lint / format
npm run lint             # ESLint
npm run lint:fix
npm run format           # Prettier
npm run typecheck        # tsc --noEmit

# Tests — frontend (vitest/jsdom)
npm run test             # watch mode
npm run test:run         # one-shot (CI)
npm run test:coverage

# Run a single frontend test file
npx vitest run src/components/__tests__/statusbar.helpers.test.ts

# Tests — Rust (inside src-tauri/)
cargo test               # all
cargo test <test_name>   # single test
```

## Architecture

### Frontend (src/)

The app is a single-page React app served inside a Tauri webview. `App.tsx` owns the top-level **boot state machine**:

- `probing` → calls `getSetupStatus()` to decide if the setup wizard is needed
- `needsSetup` → renders `SetupWizard` (3-step: Download → Configure → Done)
- `ready` → renders the main shell (Sidebar + page + StatusBar)

Cross-component navigation (e.g. Dashboard overlay linking to Settings) is done via a `cpa-navigate` DOM `CustomEvent` to avoid prop drilling.

**Stores (Zustand, `src/stores/`):**
- `cpa.ts` — CPA process status + port; subscribes to `cpa:status` Tauri events
- `logs.ts` — ring-buffer of log lines from the CPA process
- `settings.ts` — UI preferences (theme, lang); persisted to `localStorage` via `zustand/middleware`
- `toast.ts` — ephemeral toast notifications

**Tauri IPC boundary (`src/lib/tauri.ts`):** Every `invoke()` call and every Tauri plugin import lives here. Frontend code never calls `invoke` directly.

**Path alias:** `@` resolves to `src/`.

**i18n:** Strings live in `src/locales/{en,zh}.ts`. Run `node scripts/check-i18n.mjs` to detect missing keys.

### Backend (src-tauri/src/)

| Module | Responsibility |
|---|---|
| `app_config.rs` | `AppSettings` struct, file paths, settings load/save/migration (v1→v2), atomic writes, `config.yaml` bootstrap |
| `cpa_manager.rs` | `CpaState` / `CpaStatus` enum, `spawn_cpa` / `kill_cpa_at_epoch` — the single chokepoint preventing concurrent spawn races |
| `cpa_lifecycle.rs` | Higher-level start/stop: resolves paths, calls `spawn_cpa`, spawns a readiness watcher, hands off to `spawn_health_monitor` |
| `lib.rs` | HTTP liveness probe (`http_ping`/`http_health`), `spawn_health_monitor` with epoch-guarded auto-restart (exponential backoff, max 3 attempts per 60s window), Tauri builder/plugin registration |
| `install_source.rs` | `InstallSource` enum (Managed / Homebrew / SystemPath / Custom) + `resolve()` to concrete paths |
| `install_detect.rs` | Auto-detection of Homebrew / system-path installations |
| `log_stream.rs` | Captures stdout/stderr from the CPA child; streams to frontend via Tauri events |
| `commands/` | Tauri command handlers grouped by domain: `cpa`, `config`, `install`, `updater`, `diag`, `auth_files` |

**Key invariant — epoch tracking:** Every `spawn_cpa` increments `CpaState.epoch`. `kill_cpa_at_epoch(state, Some(epoch))` is a no-op if the epoch has advanced, preventing stale stop signals from clobbering a new spawn.

**`CpaStatus` wire format:** Tagged union serialized as `{"kind":"Running"}` / `{"kind":"Error","data":"..."}`. The Rust and TypeScript types must stay in sync — `cpa_manager.rs` and `src/types/cpa.ts`.

**Settings persistence:** `app-settings.json` in the OS app-data directory. Settings are written atomically (write to temp + rename). Corrupt files are quarantined as `settings.broken.<ts>.json` and defaults are returned.

**Data directories (managed source):**
```
macOS:   ~/Library/Application Support/cpa-desktop/
Windows: %APPDATA%\cpa-desktop\
Linux:   ~/.local/share/cpa-desktop/

├── bin/cli-proxy-api[.exe]   # downloaded CPA binary
├── data/
│   ├── config.yaml           # CPA configuration (authoritative port source)
│   ├── logs/                 # app logs
│   └── backups/              # config.yaml backups
└── app-settings.json         # app preferences
```

`config.yaml` is the authoritative source for the CPA port. On startup, `app_config::read_port_from_yaml` syncs any mismatch into `app-settings.json`.
