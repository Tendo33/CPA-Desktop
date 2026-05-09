# Dependencies

Use this when adding or updating dependencies.

## Baseline

| Area | Tooling |
| --- | --- |
| Native runtime | Rust stable, edition 2021 |
| Desktop shell | Tauri v2 |
| Async runtime | Tokio |
| Serialization | Serde, serde_json, serde_yaml |
| HTTP client | Reqwest |
| Frontend package manager | pnpm |
| Frontend runtime | React 18, TypeScript |
| Frontend build | Vite |
| Frontend state | Zustand |
| Frontend testing | Vitest + jsdom |
| Styling | Tailwind CSS 4, CSS variables |
| UI utilities | lucide-react, class-variance-authority, clsx, tailwind-merge |
| Motion/editor | framer-motion and Monaco only when the target app already uses them |

## Rules

- Check both `package.json` and `src-tauri/Cargo.toml` before adding a dependency.
- Use `pnpm-lock.yaml` for Rust/Tauri desktop projects.
- Do not keep `package-lock.json`, `yarn.lock`, or another package-manager
  lockfile alongside `pnpm-lock.yaml`.
- Prefer standard Rust and Tauri APIs when they keep the implementation clear.
- Add Tauri plugins only when the feature requires native permission or platform
  integration.
- Keep frontend-only dependencies out of `src-tauri/Cargo.toml`.
- Keep native dependencies out of `package.json`.
- Document capability, CSP, signing, or bundle impact when a dependency changes
  desktop runtime behavior.

## Search Before Adding

```bash
rg "crate-name|feature-name" src-tauri/Cargo.toml src-tauri/src
rg "\"package-name\"" package.json src
```
