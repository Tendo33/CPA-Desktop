# Review Checklist

Before handoff, check:

- Tauri commands are registered and have typed frontend wrappers.
- Rust serde payloads and TypeScript interfaces match.
- No raw `invoke()` calls were added outside `src/lib/tauri.ts`.
- No lock is held across `.await`, file IO, process spawn, or network calls.
- Process lifecycle changes preserve epoch/generation safety.
- App-data writes are atomic when required and preserve user-owned files.
- Capabilities, CSP, updater endpoints, and filesystem access remain narrow.
- Secrets are redacted before logs, events, and UI.
- Locale keys remain aligned across supported languages.
- Visible UI follows `DESIGN.md` when present.
- Rust tests and frontend lint/type/test checks were run or explicitly scoped.
