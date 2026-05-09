# Pre-Implementation Checklist

Use this before non-trivial Rust + Tauri + React changes.

## Scope

- [ ] Is this Rust-only, frontend-only, IPC, process lifecycle, app-data,
      updater, packaging, security, docs, or visible UI?
- [ ] Which files define the current contract?
- [ ] Does the request imply a new Tauri permission or plugin?

## Rust Native Layer

- [ ] Does this belong in commands, lifecycle, config, install source, logging,
      tray, updater, or util?
- [ ] Will any lock be held across `.await` or IO?
- [ ] Does process state need an epoch/generation check?
- [ ] Does app-data persistence need migration, quarantine, or atomic write
      behavior?
- [ ] Are secrets redacted before logs/events/errors?

## Frontend

- [ ] Does `src/lib/tauri.ts` need a new or changed wrapper?
- [ ] Do TypeScript interfaces match Rust serde output?
- [ ] Does a store or event listener need cleanup behavior?
- [ ] Do `en` and `zh` locale keys stay aligned?
- [ ] Does visible UI follow `DESIGN.md` when present?

## Verification

- [ ] What is the smallest Rust test for this change?
- [ ] What is the smallest frontend test for this change?
- [ ] Does a full Tauri build apply?
