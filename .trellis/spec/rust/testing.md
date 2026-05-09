# Rust Testing

Rust tests should cover native behavior without requiring a full webview unless
the Tauri runtime itself is the subject.

## Unit Tests

Use unit tests for:

- serde wire format
- path resolution
- settings migration
- redaction helpers
- pure install-source logic
- port/path helper behavior

## Integration Tests

Use `src-tauri/tests/` for:

- process spawn/kill lifecycle
- fixture binaries or scripts
- temp app-data directories
- config file migration across filesystem boundaries
- platform-specific behavior guarded by `#[cfg(...)]`

## Fixtures

- Put executable fixtures under `src-tauri/tests/fixtures/`.
- Guard Unix-only or Windows-only tests with `#![cfg(unix)]` or equivalent.
- Keep fixtures deterministic and short-lived.

## Required Assertions

- Public enum serialization matches TypeScript expectations.
- Concurrent start attempts are rejected.
- Stale stop/status updates cannot clobber a newer process epoch.
- Corrupt settings are quarantined instead of overwritten.
- Redaction tests prove secrets do not reach emitted log text.

## Commands

```bash
cd src-tauri
cargo test
cargo test <test_name>
cargo fmt --check
```
