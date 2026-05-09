# Verification

Use this before claiming CPA Desktop work is complete. Scale the command set to
the files touched, and run the full gate for Rust/frontend boundary changes.

## Frontend

```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm run test:run
node scripts/check-i18n.mjs
pnpm run build
```

Do not substitute npm or yarn commands unless the task is explicitly a
package-manager migration away from this stack.

## Rust Native Layer

```bash
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## Full Desktop Build

```bash
pnpm run tauri build
```

Run the full desktop build when changing:

- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/`
- updater, signing, bundle, icons, or platform-specific code
- frontend build configuration consumed by Tauri

## Focused Checks

```bash
pnpm exec vitest run src/components/__tests__/statusbar.helpers.test.ts
cd src-tauri && cargo test app_config
cd src-tauri && cargo test cpa_lifecycle
```

Use focused checks while iterating, but run the broader gate before handoff when
the change crosses Rust/frontend boundaries.
