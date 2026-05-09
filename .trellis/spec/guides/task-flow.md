# Task Flow

1. Read README, project-local agent docs, and the relevant spec index.
2. Inspect `package.json`, `src-tauri/Cargo.toml`, `tauri.conf.json`, and
   capabilities when the change touches native behavior.
3. Identify whether the work is Rust-only, frontend-only, IPC, app-data,
   process lifecycle, updater, packaging, or visible UI.
4. Update Rust and TypeScript contracts together.
5. Add or adjust focused tests.
6. Run verification.
7. For visible UI changes, inspect the app view or relevant browser-rendered
   frontend route.

## Clarify Before Editing

Ask before editing when:

- A capability, CSP, updater endpoint, or filesystem permission would need to be
  broadened.
- A change might overwrite user-owned config or external package-manager files.
- Rust and TypeScript contracts support multiple incompatible payload shapes.
- The visual direction conflicts with an existing `DESIGN.md`.
