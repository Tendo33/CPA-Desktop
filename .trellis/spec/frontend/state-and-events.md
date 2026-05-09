# State And Events

Use stores for cross-page desktop state and Tauri event subscriptions.

## Store Rules

- Initialize stores from typed Tauri helpers.
- Subscribe to Tauri events in one place per domain.
- Return and call `UnlistenFn`s during cleanup.
- Keep state serializable and small.
- Avoid storing raw secret values in frontend state unless the UI explicitly
  needs to display one-time generated credentials.

## Event Rules

| Event | Meaning |
| --- | --- |
| `cpa:status` | Native process status changed |
| `cpa:port` | Active port changed |
| `cpa:log` | Redacted stdout/stderr line arrived |
| `cpa:auto-restart` | Health monitor scheduled a bounded restart |
| `app:check-updates` | Tray/menu requested app update check |

Keep event names stable. If an event payload changes, update Rust emitters,
TypeScript types, stores, and tests together.

## Boot Flow

The top-level app should keep an explicit boot state machine, for example:

```ts
type BootState =
  | { kind: 'probing' }
  | { kind: 'needsSetup'; status: SetupStatus }
  | { kind: 'ready' }
```

Do not let the main shell render before required setup decisions are made unless
there is an intentional degraded-mode fallback.

## Tests Required

- Store initialization uses command payloads correctly.
- Event listeners update state and clean up subscriptions.
- Setup wizard and degraded states handle command failures without a blank app.
