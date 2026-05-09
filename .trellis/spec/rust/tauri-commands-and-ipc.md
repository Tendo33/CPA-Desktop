# Tauri Commands And IPC

Tauri command payloads are cross-layer contracts. Changing a Rust command means
changing TypeScript wrappers and tests in the same task.

## Command Pattern

```rust
#[tauri::command]
pub async fn start_cpa(app: tauri::AppHandle) -> Result<(), String> {
    crate::cpa_lifecycle::start(app).await
}
```

## Registration

- Add the command to the correct `commands/*.rs` file.
- Export the module from `commands/mod.rs`.
- Register the command in `tauri::generate_handler![...]`.
- Expose a typed wrapper in `src/lib/tauri.ts`.
- Update frontend stores/components to call the wrapper, not raw `invoke()`.

## Payload Contracts

- Structs consumed by TypeScript use `#[serde(rename_all = "camelCase")]`.
- Tagged unions consumed by TypeScript use
  `#[serde(tag = "kind", content = "data")]`.
- Keep TypeScript discriminated unions in sync with Rust enums.

Example:

```rust
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum CpaStatus {
    Idle,
    Starting,
    Running,
    Stopped,
    Error(String),
}
```

```ts
export type CpaStatus =
  | { kind: 'Idle' }
  | { kind: 'Starting' }
  | { kind: 'Running' }
  | { kind: 'Stopped' }
  | { kind: 'Error'; data: string }
```

## Validation And Errors

| Condition | Behavior |
| --- | --- |
| Missing managed binary | Return a small user-safe error string |
| Invalid path or config | Return validation errors; do not panic |
| External install source | Resolve paths, but do not overwrite files the app does not own |
| Port conflict | Emit/return structured `port_in_use:<port>` when possible |
| Secret-bearing config | Never include raw secret values in errors or events |

## Tests Required

- Rust serialization tests for public enums and structs.
- Frontend tests for UI branches that consume command payloads.
- Integration tests when the command starts/stops a process or touches app data.
