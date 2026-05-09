# Claude Code Project Instructions

This file is Claude Code's root entrypoint for CPA Desktop. Keep detailed
project facts in `.trellis/spec/` and keep this file thin.

## Read order

1. Start at [AGENTS.md](AGENTS.md)
2. Use [.trellis/spec/README.md](.trellis/spec/README.md) for the Trellis spec overview
3. Use [.trellis/spec/shared/index.md](.trellis/spec/shared/index.md) for repository-wide facts
4. Use [.trellis/spec/rust/index.md](.trellis/spec/rust/index.md) before Rust/Tauri work
5. Use [.trellis/spec/frontend/index.md](.trellis/spec/frontend/index.md) before frontend work
6. Run the relevant section in [.trellis/spec/shared/verification.md](.trellis/spec/shared/verification.md)

## Claude-specific notes

- Use [AGENTS.md](AGENTS.md) as the shared project entrypoint.
- Route task-specific work through `.trellis/spec/`.
- Do not reintroduce a parallel AI-docs tree; `.trellis/spec/` is the detailed project contract.
- If this file and `.trellis/spec/` disagree, update this file or follow the spec before changing code.

## Project guardrails

- CPA Desktop is a Tauri v2 + Rust + React desktop app for managing CLIProxyAPI.
- Keep all raw Tauri `invoke()` and plugin imports inside `src/lib/tauri.ts`.
- Preserve `CpaStatus` Rust/TypeScript wire shape and update both sides together.
- Keep subprocess lifecycle changes epoch-safe; stale watchers must not stop or mark a newer process.
- Treat `config.yaml` as the authoritative CPA port source and `app-settings.json` as app preference state written atomically.
- Do not overwrite user-owned external install-source files for Homebrew, SystemPath, or Custom sources.
- Use pnpm only; do not introduce npm or yarn lockfiles.

## Claude execution style

- State assumptions explicitly when they shape the solution.
- Keep diffs tightly scoped to the task.
- Match existing style even when you would normally choose differently.
- Update `.trellis/spec/` when behavior, structure, scripts, public IPC contracts, or verification commands change.
- Before declaring success, run the relevant commands in [.trellis/spec/shared/verification.md](.trellis/spec/shared/verification.md).
