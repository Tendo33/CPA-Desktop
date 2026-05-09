# Frontend Directory Structure

Use the existing React/Vite layout before creating new folders.

## Expected Layout

```text
src/
  App.tsx
  main.tsx
  index.css
  constants.ts
  lib/
    tauri.ts
    i18n.ts
    utils.ts
  stores/
    cpa.ts
    logs.ts
    settings.ts
    appSettings.ts
  components/
    ui/
    setup/
  pages/
  locales/
```

## Placement Rules

- Put command wrappers and Tauri plugin calls in `src/lib/tauri.ts`.
- Put reusable local UI primitives in `src/components/ui/`.
- Put cross-page app state in `src/stores/`.
- Put route/page-level composition in `src/pages/`.
- Put shared status formatting or parsing in `src/lib/` or component helper
  files with tests.
- Put locale strings in `src/locales/{en,zh}.ts`.

## Anti-Patterns

- Do not import `@tauri-apps/api/core` outside `src/lib/tauri.ts`.
- Do not duplicate Rust enum string literals across many components.
- Do not put app-data path logic in the frontend.
- Do not create a landing page inside a desktop application shell.
