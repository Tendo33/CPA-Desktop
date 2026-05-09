# Frontend Index

Read this before React/Vite desktop UI work.

## Baseline Modules

```text
src/
  App.tsx              # boot state machine and app shell
  lib/tauri.ts         # only raw Tauri invoke/plugin boundary
  stores/              # Zustand stores and Tauri event subscriptions
  components/          # shell, status bar, logs, config, setup, UI primitives
  pages/               # dashboard, logs, settings, auth files, about
  locales/             # en/zh translation tables
```

## Rules

- Components and stores call typed helpers from `src/lib/tauri.ts`; they do not
  call `invoke()` directly.
- Tauri event listeners must clean up `UnlistenFn`s.
- Rust payload changes update TypeScript interfaces in the same task.
- Keep locale keys aligned across `en` and `zh`.
- Keep desktop UI task-focused: dense controls, readable logs, clear status,
  predictable navigation.
- Read `DESIGN.md` before visible UI changes when present.
- CPA Desktop currently has no root `DESIGN.md`; future major UI work should
  choose or create one before changing visual direction.

## More Specific Guides

- `directory-structure.md`
- `tauri-boundary.md`
- `state-and-events.md`
- `components-and-styling.md`
- `design-md.md`
