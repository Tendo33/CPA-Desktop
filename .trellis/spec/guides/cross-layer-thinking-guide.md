# Cross-Layer Thinking Guide

Use this when a task crosses Rust, Tauri IPC, and React.

## Contract Path

1. Rust command or event payload
2. Serde shape
3. Tauri invoke handler or event emitter
4. TypeScript wrapper/type in `src/lib/tauri.ts` or `src/types/`
5. Zustand store or page/component consumer
6. Tests on both sides

## Questions

- What is the exact payload shape crossing the webview boundary?
- Is the payload stable enough to treat as a public contract?
- Does the frontend need a loading, error, or degraded state?
- Does the Rust side need to emit an event after the command returns?
- Can stale async work update state after a newer process generation exists?
- Could a secret appear in this error, log, event, or UI string?

## Required For IPC Changes

- [ ] Rust command/event updated.
- [ ] `src/lib/tauri.ts` wrapper/type updated.
- [ ] Store or component consumer updated.
- [ ] Tests cover at least one success and one relevant failure/degraded path.
- [ ] Capabilities/CSP checked if new native access is involved.
