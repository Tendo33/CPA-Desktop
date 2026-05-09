# Tauri IPC Drift

## Problem

The Rust command succeeds, but the frontend sees `undefined`, wrong field names,
or missing union variants.

## Root Cause

Rust serde output and TypeScript types drifted. Common causes:

- Rust struct uses snake_case while TypeScript expects camelCase.
- A Rust enum variant was added without updating the TypeScript union.
- A command was registered in Rust but no typed wrapper was added.
- A component called raw `invoke()` with a stale command string.

## Solution

- Add `#[serde(rename_all = "camelCase")]` for shared structs.
- Add `#[serde(tag = "kind", content = "data")]` for shared tagged unions.
- Update `src/lib/tauri.ts` and `src/types/*`.
- Add Rust serialization tests and frontend consumer tests.

## Prevention Checklist

- [ ] One Rust command change has one TypeScript wrapper change.
- [ ] Public payloads have serialization tests.
- [ ] No raw `invoke()` calls outside `src/lib/tauri.ts`.
- [ ] UI error/loading states handle command failure.
