# Shared Index

This spec assumes a repository shaped like `CPA-Desktop`:

```text
package.json              # pnpm scripts for Vite, Vitest, ESLint, Tauri CLI
pnpm-lock.yaml            # frontend lockfile
src/                      # React + Vite frontend
src/lib/tauri.ts          # only frontend module that calls Tauri invoke/plugins
src/stores/               # Zustand stores for app state and Tauri event state
src/locales/              # en/zh locale tables
src-tauri/
  Cargo.toml              # Rust native layer
  tauri.conf.json         # app, bundle, updater, CSP config
  capabilities/           # Tauri v2 permissions
  src/                    # commands, state, process lifecycle, config, tray
  tests/                  # Rust integration tests
```

## Source Of Truth

- Read `README.md` and any project-local agent docs before editing.
- Inspect `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`,
  and `src-tauri/capabilities/default.json` before stack or permission changes.
- Treat Rust `serde` shapes and TypeScript types as one contract.
- Treat app-data files and external binaries as user-owned runtime state.
- Use pnpm for frontend dependency management and scripts.
- Do not mix pnpm with npm or yarn lockfiles in this stack.

## Documentation Files

| File | Description | When to Read |
| --- | --- | --- |
| [project-overview.md](./project-overview.md) | CPA Desktop product and runtime facts | Always |
| [code-quality.md](./code-quality.md) | Mandatory quality rules | Always |
| [dependencies.md](./dependencies.md) | Stack and dependency constraints | Adding or updating dependencies |
| [verification.md](./verification.md) | Baseline verification commands | Before completion |

## Core Rules

- Do not call Tauri `invoke()` directly from components or stores; use
  `src/lib/tauri.ts`.
- Do not hold `MutexGuard`s across `.await`, process spawning, filesystem IO, or
  network requests.
- Do not log secrets, API keys, auth headers, config secrets, or raw token
  payloads.
- Do not widen filesystem permissions, CSP, updater endpoints, or plugin
  permissions casually.
- Full desktop changes run both frontend and Rust verification.

## Working Rules

- Update Rust and TypeScript contracts together.
- Add or update tests for IPC payloads, app-data migrations, subprocess
  lifecycle, and event-driven UI changes.
- Keep desktop UI dense, practical, and inspectable; avoid marketing-page
  structure inside the app shell.
