# Tauri Boundary

`src/lib/tauri.ts` is the frontend boundary for all native calls.

## Rules

- Every command gets a typed helper.
- Every helper uses the exact Rust command name once.
- Frontend components import helpers, not `invoke`.
- Tauri plugin imports stay near related helpers.
- Public TypeScript interfaces match Rust `serde` shapes.

## Pattern

```ts
import { invoke } from '@tauri-apps/api/core'

export interface AppSettings {
  schemaVersion?: number
  port: number
  autoStart: boolean
}

export const getSettings = () => invoke<AppSettings>('get_settings')
export const saveSettings = (settings: AppSettings) =>
  invoke<void>('save_settings_cmd', { settings })
```

## Contract Checklist

- [ ] Rust command exists and is registered.
- [ ] TypeScript helper exists.
- [ ] Payload names match `camelCase` serde output.
- [ ] Errors are user-safe.
- [ ] Tests cover important success and failure branches.

## Wrong Vs Correct

### Wrong

```tsx
import { invoke } from '@tauri-apps/api/core'

await invoke('start_cpa')
```

### Correct

```tsx
import { startCpa } from '@/lib/tauri'

await startCpa()
```
