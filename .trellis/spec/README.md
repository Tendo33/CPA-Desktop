# CPA Desktop Trellis Spec

Use this spec for CPA Desktop: a Tauri v2 desktop app with a Rust native layer,
React + Vite frontend, typed Tauri IPC, app-data settings, subprocess
supervision, tray integration, and updater support for CLIProxyAPI.

## Structure

### [Rust Native Layer](./rust/index.md)

Rust + Tauri patterns:

- [CPA Desktop Runtime](./rust/cpa-desktop-runtime.md)
- [Directory Structure](./rust/directory-structure.md)
- [Tauri Commands And IPC](./rust/tauri-commands-and-ipc.md)
- [State And Process Lifecycle](./rust/state-and-process-lifecycle.md)
- [App Data And Configuration](./rust/app-data-and-configuration.md)
- [Security And Capabilities](./rust/security-and-capabilities.md)
- [Testing](./rust/testing.md)

### [Frontend](./frontend/index.md)

React + Vite desktop UI patterns:

- [Directory Structure](./frontend/directory-structure.md)
- [Tauri Boundary](./frontend/tauri-boundary.md)
- [State And Events](./frontend/state-and-events.md)
- [Components And Styling](./frontend/components-and-styling.md)
- [DESIGN.md Workflow](./frontend/design-md.md)

### [Shared](./shared/index.md)

Cross-cutting project rules:

- [Project Overview](./shared/project-overview.md)
- [Code Quality](./shared/code-quality.md)
- [Dependencies](./shared/dependencies.md)
- [Verification](./shared/verification.md)

### [Guides](./guides/index.md)

Thinking and handoff guides:

- [Task Flow](./guides/task-flow.md)
- [Pre-Implementation Checklist](./guides/pre-implementation-checklist.md)
- [Cross-Layer Thinking Guide](./guides/cross-layer-thinking-guide.md)
- [Review Checklist](./guides/review-checklist.md)

### [Common Issues / Pitfalls](./big-question/index.md)

Stack-specific debugging notes:

- [Tauri IPC Drift](./big-question/tauri-ipc-drift.md)
- [Process Epoch Races](./big-question/process-epoch-races.md)
- [App Data Persistence](./big-question/app-data-persistence.md)
- [Capabilities And CSP](./big-question/capabilities-and-csp.md)

## Read Order

1. `shared/index.md`
2. `rust/index.md` before native/Tauri work
3. `frontend/index.md` before React UI work
4. `guides/pre-implementation-checklist.md` before non-trivial changes
5. `shared/verification.md`
6. `guides/review-checklist.md`

## Baseline Stack

- Rust stable, edition 2021
- Tauri v2
- Tokio
- Serde / serde_json / serde_yaml
- Reqwest
- React 18
- TypeScript
- Vite
- Vitest + jsdom
- Zustand for frontend stores
- pnpm as the package manager

## Project Bias

- Keep native concerns in `src-tauri/src/` and browser UI concerns in `src/`.
- Use pnpm for frontend scripts and lockfiles. Do not introduce npm or yarn
  lockfiles into this stack.
- Treat Tauri IPC payloads as public cross-layer contracts.
- Keep every `invoke()` wrapper in `src/lib/tauri.ts`.
- Keep subprocess lifecycle changes guarded by generation/epoch checks.
- Do not broaden Tauri capabilities, CSP, filesystem access, or updater endpoints
  unless the feature specifically requires it.
