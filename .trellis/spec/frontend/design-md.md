# DESIGN.md Workflow

Use this before UI or visual-system work in a Tauri desktop app.

## Source Priority

1. Project root `DESIGN.md`
2. Existing product, brand, or desktop UI docs
3. This spec's frontend rules
4. General taste or ad hoc inspiration

`DESIGN.md` is the visual source of truth. It does not override native security,
Tauri capabilities, IPC contracts, accessibility, or platform conventions.

## When No DESIGN.md Exists

Before major UI work, choose a starting point from
`https://github.com/VoltAgent/awesome-design-md` or `https://getdesign.md`.

Choose based on app type:

- Developer tool: pick a restrained product/workbench reference with clear
  controls, status, panels, and log/table readability.
- Consumer utility: pick a calmer desktop utility reference with explicit setup,
  progress, and recovery states.
- Branded companion app: pick a reference with stronger brand moments, but keep
  the main shell efficient.

Example:

```bash
pnpm dlx getdesign@latest add linear.app
```

## Implementation Rules

- Read `DESIGN.md` before editing visible UI files.
- Use it to guide typography, spacing, color roles, surfaces, focus states,
  controls, icon style, and motion.
- Adapt the visual language to a desktop app shell; do not create a marketing
  landing page as the first screen.
- Keep setup, logs, status, and settings screens practical and scan-friendly.
- Do not overwrite an existing `DESIGN.md` without explicit user approval.

## Handoff

For visible UI changes, mention which `DESIGN.md` was used and what app views or
browser/Tauri viewports were checked.
