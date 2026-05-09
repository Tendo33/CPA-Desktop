# Components And Styling

## Design Source

- Read the project root `DESIGN.md` before UI work.
- If no `DESIGN.md` exists, use [DESIGN.md Workflow](./design-md.md) before
  major visual changes.
- `DESIGN.md` guides visual language; accessibility, responsive behavior, and
  desktop ergonomics remain mandatory.

## Desktop UX Rules

- Prefer an app shell with stable navigation, status, and log surfaces.
- Keep operational pages dense but readable.
- Use clear buttons, toggles, tabs, inputs, and progress states for desktop
  workflows.
- Keep log views selectable and virtualized or bounded when they can grow.
- Make setup and error recovery paths explicit; never leave a blank webview.

## Component Boundaries

- Pages compose stores, command helpers, and components.
- UI primitives stay in `src/components/ui/`.
- Long operational flows, such as setup wizards, use dedicated subcomponents.
- Components should not know raw Rust command names.

## Styling

- Use shared tokens and CSS variables for themes.
- Keep global CSS limited to tokens, base styles, and app-wide utilities.
- Controls need visible focus states.
- Text must not overflow or overlap at common desktop and laptop sizes.
- Motion should clarify state transitions; avoid decorative motion that slows
  operational work.
