# CPA Desktop — Hardening & UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CPA Desktop production-ready (Phase 2: release engineering, observability, self-update) and then polish UX & introduce a design system (Phase 3), without touching the embedded `management.html`.

**Architecture:** Tauri v2 (Rust) + React 18 + TypeScript + Tailwind v4 + zustand + Vite. CPA binary is downloaded/managed by the Rust side; the frontend talks to it through Tauri commands and events.

**Tech Stack:** Rust 1.95, Tauri 2, React 18, TypeScript 5.6+, Vitest 1.x, ESLint 9 (flat), Prettier, Tailwind v4, lucide-react, Tauri plugins (autostart / fs / http / notification / opener / shell + new: updater, window-state, global-shortcut, process).

**Source spec:** [`docs/superpowers/specs/2026-04-27-cpa-desktop-hardening-design.md`](../specs/2026-04-27-cpa-desktop-hardening-design.md)

---

## Global Rules (apply to every task)

1. **Verify before commit.** Before each `git commit` you MUST run the relevant verification block from the task. If the task touches both Rust and TS, run **VERIFY-ALL** below.
2. **Never break CI.** If a task introduces a check (lint/clippy strictness), the same task MUST clean all existing violations.
3. **Smallest unit per commit.** One task = one logical commit. Tasks with multiple steps may produce multiple commits if explicitly stated.
4. **Conventional commit messages.** `<type>: <subject>` where type ∈ `feat|fix|chore|docs|test|refactor|build|ci|style|perf`.
5. **TDD when reasonable.** For pure functions (i18n key parity, `asset_name`, port parsing, `cn()`) write the test first. For Tauri/Rust integration code (process spawn, plugin wiring) write code + smoke test together — pure TDD is impractical.
6. **No placeholders, no TODOs in committed code.** If you can't finish, leave the task in `- [ ]` state and stop; do not commit half-done.
7. **Preserve user data.** Any change touching `app-settings.json` or `config.yaml` schema MUST be backwards-readable.

### VERIFY-ALL block

Run these from repo root, in order. Each must succeed (exit 0, no output marked `error`/`warning` unless explicitly accepted):

```bash
npm run lint
npm run typecheck
npm run test:run
npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

> Until **Task 1** completes, `npm run lint` / `npm run test:run` don't exist yet. Tasks **0** and the Rust portions of early tasks use a smaller subset (typecheck + build + clippy + test).

---

# Phase 2 — Release Engineering & Hardening

## Task 0: Baseline cleanup (current state → green)

Baseline scan revealed: TS6133/TS5101 (already fixed live), cargo fmt drift in 6 files, 2 clippy warnings in `log_stream.rs`. Lock these down so subsequent tasks start from green.

**Files:**
- Modify: `tsconfig.json` (already done — removed `baseUrl`)
- Modify: `src/components/Sidebar.tsx` (already done — removed unused `Theme`/`Lang` imports)
- Modify: `src-tauri/src/log_stream.rs` (clippy fix)
- Modify: anything cargo fmt rewrites (~6 files)

- [ ] **Step 1: Apply rustfmt across src-tauri**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
git diff --stat src-tauri/
```

- [ ] **Step 2: Fix `log_stream.rs` clippy warnings**

Replace lines 49 and 61 in `src-tauri/src/log_stream.rs`:

```rust
// before
for line in BufReader::new(stdout).lines().flatten() {
// after
for line in BufReader::new(stdout).lines().map_while(Result::ok) {
```

Same change for `stderr` block.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all green. clippy run with `-D warnings` MUST exit 0.

- [ ] **Step 4: Commit**

```bash
git add tsconfig.json src/components/Sidebar.tsx src-tauri/
git commit -m "chore: baseline cleanup (rustfmt, clippy, tsc baseUrl deprecation)"
```

---

## Task 1: Frontend tooling — Vitest, ESLint flat, Prettier, npm scripts

Install testing & linting infrastructure. **No project lints run before this task** — first introduce, then enforce in later tasks.

**Files:**
- Modify: `package.json` (scripts + devDeps)
- Create: `vitest.config.ts`
- Create: `eslint.config.mjs`
- Create: `.prettierrc.json`
- Create: `.editorconfig`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Install dev dependencies**

```bash
npm install --save-dev vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom jsdom \
  eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh globals \
  prettier
```

- [ ] **Step 2: Add `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: { provider: 'v8', reporter: ['text', 'html'] },
  },
})
```

- [ ] **Step 3: Add `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom'

// Mock window.matchMedia for components that read prefers-color-scheme
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}
```

- [ ] **Step 4: Add `eslint.config.mjs`**

```js
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist', 'src-tauri/target', 'node_modules', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
)
```

- [ ] **Step 5: Add `.prettierrc.json`**

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always"
}
```

- [ ] **Step 6: Add `.editorconfig`**

```ini
root = true

[*]
end_of_line = lf
charset = utf-8
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 7: Update `package.json` scripts**

Replace the `"scripts"` block:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "tauri": "tauri",
  "lint": "eslint .",
  "lint:fix": "eslint . --fix",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "typecheck": "tsc --noEmit",
  "test": "vitest",
  "test:run": "vitest run",
  "test:coverage": "vitest run --coverage"
}
```

- [ ] **Step 8: Run lint & fix existing violations**

```bash
npm run lint 2>&1 | tail -50
```

Fix any violations (likely a few `no-unused-vars` and possibly `react-hooks/exhaustive-deps` already disabled with comments). Re-run until 0 errors.

- [ ] **Step 9: Verify**

```bash
npm run lint && npm run typecheck && npm run build
```

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json vitest.config.ts eslint.config.mjs .prettierrc.json .editorconfig src/test/setup.ts
git commit -m "build: add Vitest, ESLint flat config, Prettier, lint/test scripts"
```

---

## Task 2: First frontend tests (i18n parity, utils, stores, statusbar helpers)

Establish a small, high-signal test baseline. TDD where feasible.

**Files:**
- Create: `src/lib/__tests__/i18n.test.ts`
- Create: `src/lib/__tests__/utils.test.ts`
- Create: `src/stores/__tests__/logs.test.ts`
- Create: `src/stores/__tests__/settings.test.ts`
- Create: `src/components/__tests__/statusbar.helpers.test.ts`
- Modify: `src/components/StatusBar.tsx` (export `dotClass`/`statusColor` for testing)

- [ ] **Step 1: Test — i18n key parity**

`src/lib/__tests__/i18n.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { translations } from '@/lib/i18n'

function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix]
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flattenKeys(v, prefix ? `${prefix}.${k}` : k),
  )
}

describe('i18n', () => {
  it('zh and en have identical key sets', () => {
    const zhKeys = new Set(flattenKeys(translations.zh))
    const enKeys = new Set(flattenKeys(translations.en))
    const onlyInZh = [...zhKeys].filter((k) => !enKeys.has(k))
    const onlyInEn = [...enKeys].filter((k) => !zhKeys.has(k))
    expect(onlyInZh).toEqual([])
    expect(onlyInEn).toEqual([])
  })
})
```

> Inspect `src/lib/i18n.ts` to confirm the export name is `translations`. If the current file uses a different export, adapt the import. The intent is parity, not the export name.

- [ ] **Step 2: Test — utils**

`src/lib/__tests__/utils.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { cn } from '@/lib/utils'

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', 'b')).toBe('a b')
  })
  it('skips falsy values', () => {
    expect(cn('a', false && 'b', null, undefined, 'c')).toBe('a c')
  })
})
```

- [ ] **Step 3: Test — log store**

`src/stores/__tests__/logs.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useLogStore } from '@/stores/logs'

describe('useLogStore', () => {
  beforeEach(() => useLogStore.getState().clear())

  it('starts empty', () => {
    expect(useLogStore.getState().lines).toEqual([])
  })

  it('appends a line and caps to MAX_LINES', () => {
    const { append } = useLogStore.getState()
    for (let i = 0; i < 10_005; i++) {
      append({ ts: i, level: 'stdout', text: `${i}` })
    }
    const lines = useLogStore.getState().lines
    expect(lines.length).toBeLessThanOrEqual(10_000)
    expect(lines.at(-1)?.text).toBe('10004')
  })

  it('clears', () => {
    useLogStore.getState().append({ ts: 1, level: 'stdout', text: 'x' })
    useLogStore.getState().clear()
    expect(useLogStore.getState().lines).toEqual([])
  })
})
```

> If `useLogStore`'s public API differs (different field/method names) — adapt to actual code BUT do not change the store. The store contract drives the test, not the other way around.

- [ ] **Step 4: Test — settings store**

`src/stores/__tests__/settings.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from '@/stores/settings'

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({ theme: 'dark', lang: 'en' })
  })

  it('switches theme', () => {
    useSettingsStore.getState().setTheme('light')
    expect(useSettingsStore.getState().theme).toBe('light')
  })

  it('switches lang', () => {
    useSettingsStore.getState().setLang('zh')
    expect(useSettingsStore.getState().lang).toBe('zh')
  })
})
```

- [ ] **Step 5: Refactor StatusBar to export helpers**

In `src/components/StatusBar.tsx` change `function dotClass` and `function statusColor` to `export function dotClass` / `export function statusColor`. No behavior change.

- [ ] **Step 6: Test — StatusBar helpers**

`src/components/__tests__/statusbar.helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { dotClass, statusColor } from '@/components/StatusBar'

describe('StatusBar helpers', () => {
  const cases = [
    ['Running', 'status-dot running', 'var(--c-run)'],
    ['Starting', 'status-dot starting', 'var(--c-start)'],
    ['Stopped', 'status-dot idle', 'var(--c-text-3)'],
    ['Idle', 'status-dot idle', 'var(--c-text-3)'],
  ] as const

  it.each(cases)('%s → %s / %s', (s, dot, color) => {
    expect(dotClass(s)).toBe(dot)
    expect(statusColor(s)).toBe(color)
  })

  it('object error → error dot + err color', () => {
    const status = { error: 'boom' }
    expect(dotClass(status)).toBe('status-dot error')
    expect(statusColor(status)).toBe('var(--c-err)')
  })
})
```

- [ ] **Step 7: Run tests**

```bash
npm run test:run
```

Expected: all pass.

- [ ] **Step 8: Verify + commit**

```bash
npm run lint && npm run typecheck && npm run test:run && npm run build
git add src/lib/__tests__ src/stores/__tests__ src/components/__tests__ src/components/StatusBar.tsx
git commit -m "test: add baseline frontend tests (i18n, utils, stores, statusbar)"
```

---

## Task 3: Rust unit tests

**Files:**
- Modify: `src-tauri/src/app_config.rs` (add `#[cfg(test)] mod tests`)
- Modify: `src-tauri/src/commands/updater.rs` (factor out `asset_name` to be testable; add tests)
- Modify: `src-tauri/src/cpa_manager.rs` (test `CpaStatus` serde)

- [ ] **Step 1: Test — `read_port_from_yaml`**

Append at the bottom of `src-tauri/src/app_config.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn parse_port(yaml: &str) -> Result<u16, String> {
        let val: serde_yaml::Value = serde_yaml::from_str(yaml).map_err(|e| e.to_string())?;
        val.get("port")
            .and_then(|v| v.as_u64())
            .map(|p| p as u16)
            .ok_or_else(|| "port not found".to_string())
    }

    #[test]
    fn parses_valid_port() {
        assert_eq!(parse_port("port: 8317\n").unwrap(), 8317);
    }

    #[test]
    fn rejects_missing_port() {
        assert!(parse_port("other: 1\n").is_err());
    }

    #[test]
    fn rejects_string_port() {
        assert!(parse_port("port: \"abc\"\n").is_err());
    }
}
```

> NOTE: We test the parse logic via a duplicated helper because `read_port_from_yaml` requires an `AppHandle`. Refactor opportunity for later — out of scope here.

- [ ] **Step 2: Refactor + test — `asset_name`**

In `src-tauri/src/commands/updater.rs`, change `asset_name` to take explicit args so it's testable:

```rust
fn asset_name(version: &str) -> String {
    asset_name_for(version, std::env::consts::OS, std::env::consts::ARCH)
}

fn asset_name_for(version: &str, os: &str, arch: &str) -> String {
    let os_tag = match os {
        "windows" => "windows",
        "macos" => "darwin",
        _ => "linux",
    };
    let arch_tag = match arch {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        other => other,
    };
    let ext = if os == "windows" { "zip" } else { "tar.gz" };
    let ver = version.trim_start_matches('v');
    format!("CLIProxyAPI_{ver}_{os_tag}_{arch_tag}.{ext}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_x64() {
        assert_eq!(
            asset_name_for("v1.2.3", "windows", "x86_64"),
            "CLIProxyAPI_1.2.3_windows_amd64.zip"
        );
    }

    #[test]
    fn macos_arm64_strips_v() {
        assert_eq!(
            asset_name_for("v1.0.0", "macos", "aarch64"),
            "CLIProxyAPI_1.0.0_darwin_arm64.tar.gz"
        );
    }

    #[test]
    fn linux_x64_no_v_prefix() {
        assert_eq!(
            asset_name_for("0.5.0", "linux", "x86_64"),
            "CLIProxyAPI_0.5.0_linux_amd64.tar.gz"
        );
    }
}
```

- [ ] **Step 3: Test — `CpaStatus` serde**

Append at the bottom of `src-tauri/src/cpa_manager.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_serializes_as_string() {
        let s = serde_json::to_string(&CpaStatus::Idle).unwrap();
        assert_eq!(s, "\"Idle\"");
    }

    #[test]
    fn error_serializes_as_object() {
        let s = serde_json::to_string(&CpaStatus::Error("boom".into())).unwrap();
        assert!(s.contains("\"error\""));
        assert!(s.contains("\"boom\""));
    }
}
```

> If `CpaStatus` is not `Serialize` yet (check `cpa_manager.rs`), this test will fail to compile — add `#[derive(serde::Serialize, serde::Deserialize)]` and the appropriate `#[serde(...)]` attributes that match the existing wire shape used by `app.emit("cpa:status", ...)`. Do not change wire format.

- [ ] **Step 4: Verify + commit**

```bash
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/
git commit -m "test: add Rust unit tests for app_config, updater asset_name, CpaStatus serde"
```

---

## Task 4: Rust integration test — CPA lifecycle with mock binary

Spawn a tiny mock CPA (a shell script that prints + sleeps), run it through `cpa_manager::spawn_cpa` / `kill_cpa`, assert behavior.

**Files:**
- Create: `src-tauri/tests/cpa_lifecycle.rs`
- Create: `src-tauri/tests/fixtures/mock_cpa.sh` (Unix) — Windows variant skipped via `#[cfg]`

- [ ] **Step 1: Add fixture script**

`src-tauri/tests/fixtures/mock_cpa.sh`:

```bash
#!/usr/bin/env bash
echo "mock cpa starting"
sleep 60
```

Make executable: `chmod +x src-tauri/tests/fixtures/mock_cpa.sh`.

- [ ] **Step 2: Add integration test**

`src-tauri/tests/cpa_lifecycle.rs`:

```rust
#![cfg(unix)]

use std::path::PathBuf;
use std::time::Duration;

use cpa_desktop_lib::cpa_manager::{
    check_process_alive, kill_cpa, new_shared_state, spawn_cpa, CpaStatus,
};

fn fixture() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests/fixtures/mock_cpa.sh");
    p
}

#[test]
fn spawn_and_kill_mock_cpa() {
    let state = new_shared_state(8317);
    let workdir = std::env::temp_dir();

    let _output = spawn_cpa(&fixture(), &workdir, &state).expect("spawn");
    {
        let s = state.lock().unwrap();
        assert!(matches!(s.status, CpaStatus::Starting | CpaStatus::Running));
    }

    std::thread::sleep(Duration::from_millis(150));
    assert!(check_process_alive(&state), "mock should still be alive");

    kill_cpa(&state);
    std::thread::sleep(Duration::from_millis(150));
    assert!(!check_process_alive(&state), "mock should be dead after kill");
}
```

> If `spawn_cpa` / `kill_cpa` / `check_process_alive` / `new_shared_state` aren't currently `pub` in `cpa_manager.rs`, make them `pub` (they're internal helpers — no breaking public API risk, this is a private crate).

- [ ] **Step 3: Verify + commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test cpa_lifecycle
cargo test --manifest-path src-tauri/Cargo.toml
git add src-tauri/tests/
git commit -m "test: add integration test for CPA spawn/kill lifecycle"
```

---

## Task 5: Health monitor — proper cancellation + reuse reqwest client

Fix the issue where `spawn_health_monitor` keeps looping after CPA stops, and avoid reconstructing `reqwest::Client` per ping.

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add a shared HTTP client**

Near the top of `src-tauri/src/lib.rs`, after imports:

```rust
use std::sync::OnceLock;

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .expect("reqwest client")
    })
}

pub(crate) async fn http_ping(port: u16) -> bool {
    let url = format!("http://localhost:{port}/");
    http_client().get(&url).send().await.is_ok()
}
```

Delete the old `http_ping` body (the one that builds a fresh client).

- [ ] **Step 2: Make `spawn_health_monitor` exit gracefully**

Replace the body of `spawn_health_monitor`:

```rust
pub(crate) fn spawn_health_monitor(app: tauri::AppHandle, state: SharedCpaState, port: u16) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

            let current_status = state.lock().unwrap().status.clone();
            match current_status {
                cpa_manager::CpaStatus::Running => {}
                cpa_manager::CpaStatus::Stopped | cpa_manager::CpaStatus::Idle => return,
                _ => continue,
            }

            if !cpa_manager::check_process_alive(&state) {
                let msg = "CPA process exited unexpectedly".to_string();
                {
                    let mut s = state.lock().unwrap();
                    s.status = cpa_manager::CpaStatus::Error(msg.clone());
                }
                let _ = app.emit("cpa:status", &cpa_manager::CpaStatus::Error(msg));
                return;
            }

            if !http_ping(port).await {
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                if !http_ping(port).await && !cpa_manager::check_process_alive(&state) {
                    let msg = "CPA stopped responding".to_string();
                    {
                        let mut s = state.lock().unwrap();
                        s.status = cpa_manager::CpaStatus::Error(msg.clone());
                    }
                    let _ = app.emit("cpa:status", &cpa_manager::CpaStatus::Error(msg));
                    return;
                }
            }
        }
    });
}
```

- [ ] **Step 3: Verify**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "fix: health monitor exits on Stopped/Idle and reuses reqwest client"
```

---

## Task 5b: Tray robustness + DRY `start_cpa` + safe async spawn

Three issues found in `tray.rs` review:
- (A) Tooltip detection uses `payload.contains("running")`, which false-positives on `Error("port already running")` etc.
- (B) `tray_by_id("")` is a hack — pass empty string to find any tray.
- (C) `tray_start_cpa` duplicates ~60 lines of `commands::cpa::start_cpa`.

Plus a global Rust hardening: `tauri::async_runtime::spawn` swallows panics inside the future. Wrap the spawn pattern.

**Files:**
- Create: `src-tauri/src/cpa_lifecycle.rs`
- Modify: `src-tauri/src/tray.rs`
- Modify: `src-tauri/src/commands/cpa.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/util/spawn.rs`

- [ ] **Step 1: Extract shared `start` into `cpa_lifecycle.rs`**

`src-tauri/src/cpa_lifecycle.rs`:

```rust
use tauri::{AppHandle, Emitter, Manager};

use crate::cpa_manager::{kill_cpa, spawn_cpa, CpaStatus, SharedCpaState};
use crate::log_stream::{pipe_process_output, LogBuffer};
use crate::{app_config, http_ping, spawn_health_monitor};

pub async fn start(app: AppHandle) -> Result<(), String> {
    let cpa_state = app
        .try_state::<SharedCpaState>()
        .ok_or("cpa state missing")?
        .inner()
        .clone();
    let log_buf = app
        .try_state::<LogBuffer>()
        .ok_or("log buffer missing")?
        .inner()
        .clone();

    let port = cpa_state.lock().unwrap().port;
    let binary = app_config::cpa_binary_path(&app);
    if !binary.exists() {
        let _ = app.emit("cpa:status", &CpaStatus::Idle);
        return Err("CPA binary not present".into());
    }
    if http_ping(port).await {
        cpa_state.lock().unwrap().status = CpaStatus::Running;
        let _ = app.emit("cpa:status", &CpaStatus::Running);
        return Ok(());
    }

    let workdir = app_config::data_dir(&app);
    let output = spawn_cpa(&binary, &workdir, &cpa_state).map_err(|e| {
        let _ = app.emit("cpa:status", &CpaStatus::Error(e.clone()));
        e
    })?;
    let _ = app.emit("cpa:status", &CpaStatus::Starting);
    pipe_process_output(app.clone(), log_buf, output.stdout, output.stderr);

    let app2 = app.clone();
    let state2 = cpa_state.clone();
    crate::util::spawn::supervised(async move {
        for _ in 0..30u32 {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            if http_ping(port).await {
                state2.lock().unwrap().status = CpaStatus::Running;
                let _ = app2.emit("cpa:status", &CpaStatus::Running);
                spawn_health_monitor(app2.clone(), state2.clone(), port);
                return;
            }
            if !crate::cpa_manager::check_process_alive(&state2) {
                let msg = "CPA process exited".to_string();
                state2.lock().unwrap().status = CpaStatus::Error(msg.clone());
                let _ = app2.emit("cpa:status", &CpaStatus::Error(msg));
                return;
            }
        }
        let msg = "CPA failed to start within 30s".to_string();
        state2.lock().unwrap().status = CpaStatus::Error(msg.clone());
        let _ = app2.emit("cpa:status", &CpaStatus::Error(msg));
    });
    Ok(())
}

pub fn stop(app: &AppHandle) {
    if let Some(state) = app.try_state::<SharedCpaState>() {
        kill_cpa(&state);
        let _ = app.emit("cpa:status", &CpaStatus::Stopped);
    }
}
```

Add `pub mod cpa_lifecycle;` and `pub mod util;` (with `pub mod spawn;` inside) to `lib.rs`.

- [ ] **Step 2: `util::spawn::supervised` — panic-safe spawn**

`src-tauri/src/util/mod.rs`:

```rust
pub mod spawn;
```

`src-tauri/src/util/spawn.rs`:

```rust
use std::future::Future;

/// Like `tauri::async_runtime::spawn`, but logs panics instead of swallowing them.
pub fn supervised<F>(fut: F)
where
    F: Future<Output = ()> + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let result = futures_util::FutureExt::catch_unwind(std::panic::AssertUnwindSafe(fut)).await;
        if let Err(panic) = result {
            let msg = match panic.downcast_ref::<&'static str>() {
                Some(s) => (*s).to_string(),
                None => match panic.downcast_ref::<String>() {
                    Some(s) => s.clone(),
                    None => "<non-string panic>".to_string(),
                },
            };
            log::error!("supervised future panicked: {msg}");
        }
    });
}
```

> Add `log = "0.4"` already present. Add `futures-util = "0.3"` already present.

- [ ] **Step 3: Refactor `tray.rs`**

Rewrite `tray.rs` so it (1) names the tray `"main"`, (2) parses `cpa:status` JSON into `CpaStatus`, (3) calls `cpa_lifecycle::start` instead of duplicating logic.

Replace the body of `setup_tray`:

```rust
const TRAY_ID: &str = "main";

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::new("Open Dashboard").id("show").build(app)?;
    let start = MenuItemBuilder::new("Start CPA").id("start").build(app)?;
    let stop = MenuItemBuilder::new("Stop CPA").id("stop").build(app)?;
    let open_logs = MenuItemBuilder::new("Open Log Folder").id("open-logs").build(app)?;
    let check_updates = MenuItemBuilder::new("Check for Updates").id("check-updates").build(app)?;
    let sep1 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let sep2 = tauri::menu::PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::new("Quit CPA Desktop").id("quit").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&sep1)
        .item(&start)
        .item(&stop)
        .item(&sep2)
        .item(&open_logs)
        .item(&check_updates)
        .item(&sep2)
        .item(&quit)
        .build()?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("CPA Desktop — Stopped")
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "start" => {
                let app_c = app.clone();
                crate::util::spawn::supervised(async move {
                    let _ = crate::cpa_lifecycle::start(app_c).await;
                });
            }
            "stop" => crate::cpa_lifecycle::stop(app),
            "open-logs" => {
                let dir = crate::app_config::logs_dir(app);
                let _ = std::fs::create_dir_all(&dir);
                let _ = tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>);
            }
            "check-updates" => { let _ = app.emit("app:check-updates", ()); }
            "quit" => { crate::cpa_lifecycle::stop(app); app.exit(0); }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    let app3 = app.clone();
    app.listen("cpa:status", move |event| {
        let tooltip = match serde_json::from_str::<CpaStatus>(event.payload()) {
            Ok(CpaStatus::Running) => "CPA Desktop — Running ✓",
            Ok(CpaStatus::Starting) => "CPA Desktop — Starting…",
            Ok(CpaStatus::Stopped) => "CPA Desktop — Stopped",
            Ok(CpaStatus::Idle) => "CPA Desktop — Not downloaded",
            Ok(CpaStatus::Error(_)) => "CPA Desktop — Error",
            Err(_) => "CPA Desktop",
        };
        if let Some(tray) = app3.tray_by_id(TRAY_ID) {
            let _ = tray.set_tooltip(Some(tooltip));
        }
    });

    Ok(())
}
```

Delete `tray_start_cpa` (now lives in `cpa_lifecycle::start`).

> Need `CpaStatus: Deserialize`. Add `Deserialize` derive in Task 3 (already adds Serialize) — extend to `Deserialize` here.

- [ ] **Step 4: Re-route `commands::cpa::start_cpa` to share logic**

In `src-tauri/src/commands/cpa.rs::start_cpa`, replace the body with a delegation:

```rust
#[tauri::command]
pub async fn start_cpa(app: AppHandle) -> Result<(), String> {
    crate::cpa_lifecycle::start(app).await
}
```

Keep `stop_cpa` similar:

```rust
#[tauri::command]
pub async fn stop_cpa(app: AppHandle) -> Result<(), String> {
    crate::cpa_lifecycle::stop(&app);
    Ok(())
}
```

- [ ] **Step 5: Verify + commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
git add src-tauri/
git commit -m "refactor: extract cpa_lifecycle, name tray, deserialize status payload, supervised spawn"
```

---

## Task 6: Tighten CSP + scoped fs permissions

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Narrow CSP**

In `src-tauri/tauri.conf.json` replace `connect-src`:

```
"csp": "default-src 'self'; connect-src 'self' http://localhost:* https://api.github.com https://github.com https://objects.githubusercontent.com https://*.githubusercontent.com; img-src 'self' data: blob: http://localhost:* https://*; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data: https://*"
```

- [ ] **Step 2: Replace recursive fs perms with scoped**

In `src-tauri/capabilities/default.json` replace the two `fs:allow-app-*-recursive` entries with scoped writes. Final permissions:

```json
"permissions": [
  "core:default",
  "core:event:default",
  "core:window:default",
  "core:webview:default",
  "shell:allow-execute",
  "shell:allow-open",
  "fs:default",
  { "identifier": "fs:allow-read-file",  "allow": [{ "path": "$APPDATA/cpa-desktop/**" }] },
  { "identifier": "fs:allow-write-file", "allow": [{ "path": "$APPDATA/cpa-desktop/**" }] },
  { "identifier": "fs:allow-mkdir",      "allow": [{ "path": "$APPDATA/cpa-desktop/**" }] },
  "notification:default",
  "http:default",
  "opener:default",
  "autostart:allow-enable",
  "autostart:allow-disable",
  "autostart:allow-is-enabled"
]
```

- [ ] **Step 3: Verify (dev build smoke test)**

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

> A full `tauri dev` run is expensive; rely on cargo check + a manual smoke run if you have time. If a permission was needed elsewhere, you'll see a `forbidden by ACL` runtime error during real testing — re-add narrowly then.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "fix: tighten CSP connect-src and scope fs permissions to app data dir"
```

---

## Task 7: Auto-start CPA on `RunEvent::Ready` instead of fixed sleep

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Refactor**

Inside `run()`, move the auto-start logic out of `setup` and into the `.run(|app, event| ...)` callback, triggered on `RunEvent::Ready`. Pseudocode skeleton (adapt to existing variables):

```rust
// In setup: store settings.auto_start in state, no spawn here.
let cpa_state = ...;
{
    let mut s = cpa_state.lock().unwrap();
    s.auto_start_pending = settings.auto_start;
}

// In .run(...) callback:
.run(|app, event| {
    if let tauri::RunEvent::Ready = event {
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            let cpa_state = app2.state::<SharedCpaState>().inner().clone();
            let pending = {
                let s = cpa_state.lock().unwrap();
                s.auto_start_pending
            };
            if !pending { return; }
            // ... existing auto-start body ...
        });
    }
    // existing reopen + ExitRequested handlers
});
```

> Add `auto_start_pending: bool` to `CpaState` struct in `cpa_manager.rs`. Default false.

- [ ] **Step 2: Verify**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 3: Commit**

```bash
git add src-tauri/
git commit -m "refactor: trigger auto-start CPA on RunEvent::Ready"
```

---

## Task 8: Window state persistence

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Add plugin**

```bash
cargo add tauri-plugin-window-state --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 2: Register plugin**

In `lib.rs` `tauri::Builder::default().plugin(...)` chain, add:

```rust
.plugin(tauri_plugin_window_state::Builder::default().build())
```

- [ ] **Step 3: Add capability permission**

Append to `permissions` in `capabilities/default.json`:

```
"window-state:default"
```

- [ ] **Step 4: Verify + commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git add src-tauri/
git commit -m "feat: persist window size and position across restarts"
```

---

## Task 8b: Settings file hardening — schema_version + corruption recovery

Today `app_config::load_settings` `unwrap_or_default()` on parse failure, which silently wipes the user's settings. Two fixes:

1. Add a `schema_version: u32` field so future migrations are explicit.
2. On parse error, rename the broken file to `settings.broken.<ts>.json` and log a warning, instead of silently overwriting on next save.

**Files:**
- Modify: `src-tauri/src/app_config.rs`
- Modify: `src-tauri/src/commands/settings.rs` (only if struct field list is enumerated)
- Add test in `src-tauri/tests/app_config_tests.rs`

- [ ] **Step 1: Update `Settings` struct**

```rust
pub const SETTINGS_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub theme: String,
    pub lang: String,
    pub auto_start: bool,
    pub auto_check_updates: bool,
    pub port: u16,
    pub last_panic: Option<String>,
    // ...existing fields...
}

fn default_schema_version() -> u32 { SETTINGS_SCHEMA_VERSION }

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            // ...defaults
        }
    }
}
```

- [ ] **Step 2: `load_settings` quarantines corrupt files**

```rust
pub fn load_settings(app: &AppHandle) -> Settings {
    let path = settings_path(app);
    if !path.exists() {
        return Settings::default();
    }
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("settings unreadable: {e}; using defaults");
            return Settings::default();
        }
    };
    match serde_json::from_str::<Settings>(&raw) {
        Ok(s) => s,
        Err(e) => {
            let ts = chrono::Utc::now().format("%Y%m%dT%H%M%S");
            let backup = path.with_file_name(format!("settings.broken.{ts}.json"));
            let _ = fs::rename(&path, &backup);
            log::error!(
                "settings corrupted: {e}; quarantined to {}",
                backup.display()
            );
            Settings::default()
        }
    }
}
```

- [ ] **Step 3: Test**

`src-tauri/tests/app_config_tests.rs`:

```rust
#[test]
fn quarantines_corrupt_settings_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    std::fs::write(&path, "not-json{").unwrap();
    let s = cpa_desktop::app_config::load_settings_at(&path);
    assert_eq!(s.schema_version, cpa_desktop::app_config::SETTINGS_SCHEMA_VERSION);
    let mut entries: Vec<_> = std::fs::read_dir(dir.path()).unwrap()
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    entries.sort();
    assert!(entries.iter().any(|n| n.starts_with("settings.broken.")));
}
```

> Requires extracting a `load_settings_at(path: &Path)` helper for testability.

- [ ] **Step 4: Verify + commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
git add src-tauri/
git commit -m "feat(settings): add schema_version + quarantine corrupted settings file"
```

---

## Task 9: Global shortcuts (Cmd/Ctrl+R reload, +, settings, +L logs)

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add plugin**

```bash
cargo add tauri-plugin-global-shortcut --manifest-path src-tauri/Cargo.toml
```

```bash
npm install @tauri-apps/plugin-global-shortcut
```

- [ ] **Step 2: Register plugin (Rust)**

In `lib.rs`:

```rust
.plugin(tauri_plugin_global_shortcut::Builder::new().build())
```

- [ ] **Step 3: Add capabilities**

Append:

```
"global-shortcut:default"
```

- [ ] **Step 4: Wire shortcuts in `App.tsx`**

Inside `App` component, add an effect:

```ts
import { register, unregister } from '@tauri-apps/plugin-global-shortcut'

useEffect(() => {
  if (binaryReady !== true) return
  let cancelled = false
  const bindings: Array<[string, () => void]> = [
    ['CmdOrCtrl+,', () => setPage('settings')],
    ['CmdOrCtrl+L', () => setPage('logs')],
    ['CmdOrCtrl+R', () => {
      if (page === 'dashboard') {
        // CpaWebView reload via ref — exposed in next task; no-op for now
      }
    }],
  ]
  ;(async () => {
    for (const [key, fn] of bindings) {
      try { await register(key, fn) } catch {}
      if (cancelled) return
    }
  })()
  return () => {
    cancelled = true
    bindings.forEach(([key]) => { unregister(key).catch(() => {}) })
  }
}, [binaryReady, page])
```

- [ ] **Step 5: Verify + commit**

```bash
npm run lint && npm run typecheck && npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git add .
git commit -m "feat: global shortcuts for settings/logs (Cmd/Ctrl+, and Cmd/Ctrl+L)"
```

---

## Task 9b: Single-instance lock

Two CPA Desktop processes started simultaneously will both bind the tray, both spawn cpa.exe, and corrupt settings on save. Use `tauri-plugin-single-instance` to forward args to the existing instance and focus its window.

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json` (no change needed — plugin needs no perms)

- [ ] **Step 1: Add dep**

```toml
tauri-plugin-single-instance = { version = "2", features = ["deep-link"] }
```

> If we don't ship deep-link handling, drop the feature flag.

- [ ] **Step 2: Register before any other plugin**

In `lib.rs`, before `.plugin(tauri_plugin_log::Builder::...)`:

```rust
.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}))
```

- [ ] **Step 3: Manual verification + commit**

```bash
cargo run --manifest-path src-tauri/Cargo.toml
# In another terminal: cargo run again — second instance should exit and focus the first window.
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git add src-tauri/
git commit -m "feat: single-instance lock; forward focus to existing window"
```

---

## Task 10: Tray menu additions

**Files:**
- Modify: `src-tauri/src/tray.rs`

- [ ] **Step 1: Read current tray.rs and add two menu items**

Add menu items: "Open Log Folder" → opens `data_dir/logs` via `tauri-plugin-opener`; "Check for App Updates" → emits `app:check-updates` event for the frontend (frontend handler comes in Task 15).

Concrete additions inside the tray menu builder:

```rust
let open_logs = MenuItemBuilder::new("Open Log Folder").id("open-logs").build(app)?;
let check_updates = MenuItemBuilder::new("Check for Updates").id("check-updates").build(app)?;
```

Append both before the `Quit` item. In the `on_menu_event` handler:

```rust
"open-logs" => {
    if let Some(dir) = crate::app_config::logs_dir(app).to_str() {
        let _ = tauri_plugin_opener::open_path(dir, None::<&str>);
    }
}
"check-updates" => {
    let _ = app.emit("app:check-updates", ());
}
```

> `app_config::logs_dir` will be added in Task 11; for now stub it as `data_dir(app).join("logs")` returning `PathBuf`.

- [ ] **Step 2: Verify + commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git add src-tauri/src/
git commit -m "feat: tray menu — open log folder, check for updates"
```

---

## Task 11: Rust panic hook + log directory + rotation

**Files:**
- Modify: `src-tauri/src/app_config.rs` (add `logs_dir` helper + `last_panic` field)
- Create: `src-tauri/src/panic_log.rs`
- Modify: `src-tauri/src/lib.rs` (install hook in `run()` first line)

- [ ] **Step 1: `app_config` helpers**

Append to `app_config.rs`:

```rust
pub fn logs_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    let mut p = data_dir(app);
    p.push("logs");
    p
}
```

Add to the `Settings` struct (or whichever serde struct represents `app-settings.json`):

```rust
#[serde(default)]
pub last_panic: Option<LastPanic>,
```

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LastPanic {
    pub at_iso: String,
    pub message: String,
    pub file: Option<String>,
    pub line: Option<u32>,
}
```

- [ ] **Step 2: Panic hook module**

`src-tauri/src/panic_log.rs`:

```rust
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

pub fn install(logs_dir: PathBuf, settings_path: PathBuf) {
    std::panic::set_hook(Box::new(move |info| {
        let _ = create_dir_all(&logs_dir);
        let date = chrono::Local::now().format("%Y%m%d");
        let path = logs_dir.join(format!("panic-{date}.log"));
        let now = chrono::Local::now().to_rfc3339();
        let payload = format!("{now} | {info}\n");
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
            let _ = f.write_all(payload.as_bytes());
        }
        // Persist a compact summary into app-settings.json
        if let Ok(content) = std::fs::read_to_string(&settings_path) {
            if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                let last_panic = serde_json::json!({
                    "at_iso": now,
                    "message": format!("{info}"),
                });
                if let Some(obj) = json.as_object_mut() {
                    obj.insert("last_panic".into(), last_panic);
                    if let Ok(out) = serde_json::to_string_pretty(&json) {
                        let _ = std::fs::write(&settings_path, out);
                    }
                }
            }
        }
        rotate(&logs_dir);
    }));
}

fn rotate(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("panic-"))
        .collect();
    files.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
    while files.len() > 5 {
        if let Some(old) = files.first() {
            let _ = std::fs::remove_file(old.path());
        }
        files.remove(0);
    }
}
```

- [ ] **Step 3: Install hook in `run()`**

At the very top of `pub fn run()`, before `tauri::Builder::default()`:

```rust
// Hook installation needs paths; we resolve them lazily after first AppHandle exists.
```

The cleanest path: install hook inside `setup(|app| { ... })` first lines, after `ensure_dirs`:

```rust
let logs = app_config::logs_dir(app.handle());
let settings_path = app_config::settings_path(app.handle());
panic_log::install(logs, settings_path);
```

> Add a `pub fn settings_path(app: &AppHandle) -> PathBuf` helper to `app_config.rs` if it doesn't exist (it's the `app-settings.json` path).

- [ ] **Step 4: Declare module**

In `lib.rs` add `mod panic_log;` near the other `mod` declarations.

- [ ] **Step 5: Verify + commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
git add src-tauri/
git commit -m "feat: rust panic hook writes panic-YYYYMMDD.log + last_panic in settings"
```

---

## Task 11b: Adopt `tauri-plugin-log` + extract `DEFAULT_PORT`

Replace the ad-hoc `app.log` writer (currently sprinkled across `lib.rs`, `cpa_manager.rs`, `tray.rs` with `eprintln!` and `writeln!`) with `tauri-plugin-log`. Two wins: structured per-level logs, automatic rotation; gives the frontend a single `log::*` API via plugin commands.

Also: `8087` is hard-coded in 4 places. Hoist it to `pub const DEFAULT_PORT: u16 = 8087;` in `app_config.rs`.

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/app_config.rs` (add `DEFAULT_PORT`)
- Sweep replace `8087` literal with `app_config::DEFAULT_PORT`
- Replace `eprintln!`/file-write log calls with `log::info!` / `log::error!`

- [ ] **Step 1: Dep + builder**

```toml
tauri-plugin-log = "2"
```

```rust
.plugin(
    tauri_plugin_log::Builder::default()
        .targets([
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir { file_name: Some("cpa-desktop".into()) }),
        ])
        .level(log::LevelFilter::Info)
        .max_file_size(2 * 1024 * 1024)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
        .build(),
)
```

- [ ] **Step 2: Sweep `8087`**

```bash
rg -n "\b8087\b" src-tauri src
```

Replace each Rust occurrence with `app_config::DEFAULT_PORT`; replace each TS occurrence with the value returned from `get_settings()` (or a frontend constant in `src/constants.ts`).

- [ ] **Step 3: Sweep ad-hoc log writes**

Replace `eprintln!("...")` / `writeln!(app_log, "...")` with `log::info!`/`log::warn!`/`log::error!`. Keep panic-log file (Task 11) since panics must be captured even before plugin-log is initialised.

- [ ] **Step 4: Verify + commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
git add src-tauri/ src/
git commit -m "refactor: tauri-plugin-log for structured rotated logs; hoist DEFAULT_PORT"
```

---

## Task 12: Frontend ErrorBoundary + `report_frontend_error` command

**Files:**
- Create: `src/components/ErrorBoundary.tsx`
- Modify: `src/main.tsx` (wrap `<App/>`)
- Modify: `src-tauri/src/commands/mod.rs` + new `src-tauri/src/commands/diag.rs`
- Modify: `src-tauri/src/lib.rs` (register command)
- Modify: `src/lib/tauri.ts` (export wrapper)

- [ ] **Step 1: Rust command**

`src-tauri/src/commands/diag.rs`:

```rust
use std::fs::OpenOptions;
use std::io::Write;
use tauri::AppHandle;

#[tauri::command]
pub fn report_frontend_error(app: AppHandle, message: String, stack: Option<String>) -> Result<(), String> {
    let logs = crate::app_config::logs_dir(&app);
    std::fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
    let path = logs.join("frontend-errors.log");
    let now = chrono::Local::now().to_rfc3339();
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let line = format!(
        "{now} | {}\n{}\n---\n",
        message,
        stack.as_deref().unwrap_or("(no stack)")
    );
    f.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}
```

In `commands/mod.rs` add `pub mod diag;`. In `lib.rs` `invoke_handler!` macro add `commands::diag::report_frontend_error`.

- [ ] **Step 2: TS wrapper**

Append to `src/lib/tauri.ts`:

```ts
export async function reportFrontendError(message: string, stack?: string) {
  return invoke('report_frontend_error', { message, stack })
}
```

- [ ] **Step 3: ErrorBoundary**

`src/components/ErrorBoundary.tsx`:

```tsx
import { Component, type ReactNode } from 'react'
import { reportFrontendError } from '@/lib/tauri'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    reportFrontendError(error.message, error.stack ?? info.componentStack ?? undefined).catch(() => {})
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 24, height: '100vh', display: 'flex',
          flexDirection: 'column', gap: 12, background: 'var(--c-bg)', color: 'var(--c-text-1)',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>Something went wrong.</h2>
          <pre className="selectable" style={{
            fontSize: 12, color: 'var(--c-err)', whiteSpace: 'pre-wrap',
            padding: 12, background: 'var(--c-err-bg)', borderRadius: 6, maxHeight: '60vh', overflow: 'auto',
          }}>{this.state.error.message}{'\n'}{this.state.error.stack}</pre>
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Dismiss
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
```

- [ ] **Step 4: Wrap App**

In `src/main.tsx`:

```tsx
import { ErrorBoundary } from '@/components/ErrorBoundary'
// ...
<React.StrictMode>
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
</React.StrictMode>
```

- [ ] **Step 5: Verify + commit**

```bash
npm run lint && npm run typecheck && npm run test:run && npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git add .
git commit -m "feat: frontend ErrorBoundary + report_frontend_error command"
```

---

## Task 12b: `CpaStatus` as TypeScript discriminated union

Today the frontend uses the loose `CpaStatus = 'Idle' | 'Stopped' | 'Starting' | 'Running' | { Error: string }` and string-matches on `'Running'` literals everywhere. Two issues:

- `serde`'s untagged enum produces `{ "Error": "..." }` on payload, but `'Idle'` produces a bare string — ad-hoc consumers in `Sidebar`, `StatusBar`, `Dashboard` each re-implement narrowing.
- Adding a new variant (e.g. `Updating`) requires sweeping 6+ files.

Switch to `#[serde(tag = "kind", content = "data")]` on Rust and a typed union + helper guards on the frontend.

**Files:**
- Modify: `src-tauri/src/cpa_manager.rs`
- Modify: `src/types/cpa.ts` (new)
- Modify: `src/lib/cpaStatus.ts` (new — guards)
- Modify: `src/stores/*.ts`, `src/components/{StatusBar,Sidebar,Dashboard}.tsx`

- [ ] **Step 1: Rust**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", content = "data")]
pub enum CpaStatus {
    Idle,
    Stopped,
    Starting,
    Running,
    Error(String),
}
```

> This is a breaking change to the wire format. Bump `schema_version` (Task 8b) and migrate any persisted status copy.

- [ ] **Step 2: Frontend types + guards**

`src/types/cpa.ts`:

```ts
export type CpaStatus =
  | { kind: 'Idle' }
  | { kind: 'Stopped' }
  | { kind: 'Starting' }
  | { kind: 'Running' }
  | { kind: 'Error'; data: string }
```

`src/lib/cpaStatus.ts`:

```ts
export const isRunning = (s: CpaStatus) => s.kind === 'Running'
export const isStarting = (s: CpaStatus) => s.kind === 'Starting'
export const errorOf = (s: CpaStatus) => (s.kind === 'Error' ? s.data : null)
```

- [ ] **Step 3: Sweep callsites**

```bash
rg -n "'Running'|'Starting'|'Stopped'|CpaStatus" src
```

Replace string comparisons with `isRunning(status)` etc.

- [ ] **Step 4: Update tests + commit**

```bash
npm run typecheck && npm run test:run
cargo test --manifest-path src-tauri/Cargo.toml
git add .
git commit -m "refactor: CpaStatus as tagged union end-to-end; remove string-match narrowing"
```

---

## Task 13: About page — show "last panic" if present

**Files:**
- Modify: `src/pages/About.tsx`
- Modify: `src/lib/tauri.ts` (load settings already returns `last_panic`)

- [ ] **Step 1: Type + UI**

Extend `AppSettings` type in `src/lib/tauri.ts`:

```ts
export interface LastPanic { atIso: string; message: string }
export interface AppSettings {
  port: number
  autoStart: boolean
  cpaVersion?: string
  lastPanic?: LastPanic
  // existing fields
}
```

> Match camelCase names to Rust `#[serde(rename_all = "camelCase")]` (verify in `app_config.rs` — add it if missing).

In `About.tsx` add a section near the top (only if `lastPanic`):

```tsx
{lastPanic && (
  <section className="card" style={{ borderColor: 'var(--c-err)', padding: 12 }}>
    <h3 style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-err)', marginBottom: 4 }}>
      Last crash
    </h3>
    <p style={{ fontSize: 11, color: 'var(--c-text-3)' }}>{lastPanic.atIso}</p>
    <p style={{ fontSize: 12, color: 'var(--c-text-2)', marginTop: 4 }}>{lastPanic.message}</p>
    <button className="btn btn-ghost" onClick={() => openLogsFolder()}>Open log folder</button>
  </section>
)}
```

- [ ] **Step 2: Add `openLogsFolder` Rust command**

In `commands/diag.rs`:

```rust
#[tauri::command]
pub fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    let dir = crate::app_config::logs_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}
```

Register in `invoke_handler!`. Add TS wrapper `openLogsFolder()`.

- [ ] **Step 3: Verify + commit**

```bash
npm run lint && npm run typecheck && npm run test:run && npm run build
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git add .
git commit -m "feat: surface last panic on About page + open logs folder"
```

---

## Task 14: Tauri self-updater plugin

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `package.json`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Generate signing keys (one-time)**

```bash
npx tauri signer generate -w ~/.tauri/cpa-desktop.key
```

This produces `~/.tauri/cpa-desktop.key` (private) and `~/.tauri/cpa-desktop.key.pub` (public). The CLI prints the public key string — copy it.

> Add the **private** key contents and password to GitHub repository secrets:
> - `TAURI_SIGNING_PRIVATE_KEY` (the file contents, multi-line)
> - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the passphrase you chose)

- [ ] **Step 2: Add deps**

```bash
cargo add tauri-plugin-updater tauri-plugin-process --manifest-path src-tauri/Cargo.toml
npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process
```

- [ ] **Step 3: `tauri.conf.json` plugin block**

Add a top-level `"plugins"` key:

```json
"plugins": {
  "updater": {
    "active": true,
    "endpoints": [
      "https://github.com/<owner>/CPA-Desktop/releases/latest/download/latest.json"
    ],
    "pubkey": "<paste public key string here>"
  }
}
```

> Replace `<owner>` with the actual GitHub user/org. If unknown, leave a `TODO(owner)` comment in the spec note (NOT in JSON) and stop the task — do not commit a placeholder.

- [ ] **Step 4: Register plugins**

In `lib.rs`:

```rust
.plugin(tauri_plugin_updater::Builder::new().build())
.plugin(tauri_plugin_process::init())
```

- [ ] **Step 5: Capabilities**

Append:

```
"updater:default",
"process:default"
```

- [ ] **Step 6: Verify + commit**

```bash
npm run typecheck && npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git add .
git commit -m "feat: integrate tauri-plugin-updater + plugin-process"
```

---

## Task 15: Auto-check app updates UI

**Files:**
- Modify: `src/lib/tauri.ts` (add updater wrappers)
- Modify: `src/pages/Settings.tsx`
- Modify: `src/stores/settings.ts` (add `autoCheckAppUpdates: bool`)
- Modify: `src/App.tsx` (schedule check on launch, listen to `app:check-updates`)
- Modify: `src-tauri/src/app_config.rs` (persist `autoCheckAppUpdates`)

- [ ] **Step 1: Settings field**

In `app_config.rs` `Settings` struct add:

```rust
#[serde(default)]
pub auto_check_app_updates: bool,
```

Default `false` for first release; user can opt in.

- [ ] **Step 2: TS hooks**

In `src/lib/tauri.ts`:

```ts
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export async function checkAppUpdate(): Promise<Update | null> {
  return await check()
}

export async function applyAppUpdate(update: Update) {
  await update.downloadAndInstall()
  await relaunch()
}
```

- [ ] **Step 3: Settings UI button**

In `Settings.tsx` add a row in the Application section:

```tsx
<Row label="Check for app updates" hint={updateMsg}>
  <button className="btn btn-ghost" onClick={onCheckUpdate}>Check now</button>
</Row>
<Row label="Auto-check on launch" hint="Once every 6 hours">
  <Toggle checked={settings.autoCheckAppUpdates ?? false}
          onChange={(v) => setSettings({ ...settings, autoCheckAppUpdates: v })} />
</Row>
```

`onCheckUpdate` body:

```ts
const onCheckUpdate = async () => {
  setUpdateMsg('Checking…')
  try {
    const u = await checkAppUpdate()
    if (!u) { setUpdateMsg('Up to date'); return }
    if (confirm(`Update ${u.version} available. Install now?`)) {
      setUpdateMsg('Downloading…')
      await applyAppUpdate(u)
    } else {
      setUpdateMsg(`v${u.version} available`)
    }
  } catch (e) { setUpdateMsg(String(e)) }
}
```

- [ ] **Step 4: Auto-check effect**

In `App.tsx` add:

```ts
useEffect(() => {
  const settings = useSettingsStore.getState()
  if (!settings.autoCheckAppUpdates) return
  const tid = setTimeout(async () => {
    try {
      const u = await checkAppUpdate()
      if (u) {
        // surface a toast/notification (minimal: console + window event)
        const notif = await import('@tauri-apps/plugin-notification')
        const granted = await notif.isPermissionGranted()
        if (granted) notif.sendNotification({ title: 'CPA Desktop update available', body: `v${u.version}` })
      }
    } catch {}
  }, 6 * 60 * 60 * 1000)
  return () => clearTimeout(tid)
}, [])
```

Also in `App.tsx`, listen to the `app:check-updates` event from tray and call `onCheckUpdate` equivalent.

- [ ] **Step 5: Verify + commit**

```bash
npm run lint && npm run typecheck && npm run test:run && npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git add .
git commit -m "feat: app self-update via plugin-updater + auto-check toggle"
```

---

## Task 16: Port conflict detection + suggest +1

**Files:**
- Modify: `src-tauri/src/cpa_manager.rs` or wherever spawn errors propagate (check `commands/cpa.rs::start_cpa`)
- Modify: `src/pages/Dashboard.tsx` (UI prompt) or a small toast util

- [ ] **Step 1: Detect & emit a structured error**

When CPA stderr contains `address already in use`, set `CpaStatus::Error(format!("port_in_use:{port}"))` instead of generic message. The frontend parses the prefix.

- [ ] **Step 2: UI**

In `Dashboard.tsx` error overlay, when error matches `/^port_in_use:(\d+)/`:

```tsx
{portInUseMatch && (
  <button className="btn btn-primary" onClick={async () => {
    const next = Number(portInUseMatch[1]) + 1
    await saveSettings({ ...settings, port: next })
    await writeConfigYamlPort(next)
    await startCpa()
  }}>
    Try port {Number(portInUseMatch[1]) + 1}
  </button>
)}
```

> Add `writeConfigYamlPort(n)` Rust command that updates only the `port:` line via `serde_yaml`. Reuse Task 30's helper if landed; otherwise add a stub.

- [ ] **Step 3: Verify + commit**

```bash
npm run lint && npm run typecheck && npm run test:run && npm run build
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git add .
git commit -m "feat: detect port conflict and offer one-click +1"
```

---

## Task 17: README screenshots + LICENSE consistency

**Files:**
- Modify: `README.md`
- Possibly modify: `LICENSE` and/or `tauri.conf.json` (if license needs to change)
- Add: `docs/screenshots/dashboard.png`, `logs.png`, `settings.png`

- [ ] **Step 1: Confirm LICENSE**

Read `LICENSE`. If it contains `MIT License`, leave README "License: MIT" alone. If GPL or other, update both.

- [ ] **Step 2: Capture screenshots**

Manual step: run `npm run tauri dev`, capture three 1280×800 PNGs of Dashboard / Logs / Settings, drop into `docs/screenshots/`.

- [ ] **Step 3: Update README**

Replace the `## Screenshots` section:

```markdown
## Screenshots

| Dashboard | Logs | Settings |
|---|---|---|
| ![](docs/screenshots/dashboard.png) | ![](docs/screenshots/logs.png) | ![](docs/screenshots/settings.png) |
```

Add an "Unsigned builds" note for macOS/Windows (Phase 2 doesn't sign):

```markdown
## Unsigned builds

Until 0.2.0 the binaries are unsigned. On macOS, run once:

```sh
xattr -cr "/Applications/CPA Desktop.app"
```

On Windows, click "More info" → "Run anyway" on the SmartScreen prompt.
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/screenshots LICENSE
git commit -m "docs: add screenshots, document unsigned-build workaround"
```

---

## Task 18: CI hardening (`ci.yml`)

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Replace `ci.yml` body**

```yaml
name: CI

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main]

jobs:
  check:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: windows-latest
            name: windows
          - platform: macos-latest
            name: macos
          - platform: ubuntu-22.04
            name: linux

    runs-on: ${{ matrix.platform }}
    name: Check (${{ matrix.name }})

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy, rustfmt

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: './src-tauri -> target'

      - name: Install Linux system dependencies
        if: matrix.name == 'linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libappindicator3-dev \
            librsvg2-dev \
            patchelf

      - name: Install frontend dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck

      - name: Frontend tests
        run: npm run test:run

      - name: Frontend build
        run: npm run build

      - name: Cargo fmt
        run: cargo fmt --check --manifest-path src-tauri/Cargo.toml

      - name: Cargo clippy
        run: cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

      - name: Cargo test
        run: cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 2: Verify locally + commit**

Run the VERIFY-ALL block. All green.

```bash
git add .github/workflows/ci.yml
git commit -m "ci: enforce lint/test/fmt/clippy on all platforms"
```

---

## Task 19: Release CI updater wiring (`release.yml`)

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Inject signing env + updater JSON**

In the `Build Tauri app` step, add to `env:`:

```yaml
TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

In `with:`:

```yaml
includeUpdaterJson: true
```

- [ ] **Step 2: Guard Apple secrets**

Wrap the Apple env vars with `if`:

```yaml
APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE || '' }}
```

Continue building unsigned if secrets missing.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: sign updater JSON in release builds; tolerate missing Apple secrets"
```

---

## Task 20: v0.1.x verification & tag

This task is human-driven; it gates Phase 2 → Phase 3.

- [ ] **Step 1: Run full VERIFY-ALL one last time**

- [ ] **Step 2: Push to dev branch, watch CI**

Confirm green on all three platforms.

- [ ] **Step 3: Tag**

```bash
git checkout main
git merge --no-ff dev
git tag -a v0.1.1 -m "Phase 2: hardening release"
git push --follow-tags
```

- [ ] **Step 4: Smoke-test the published artifact**

Download from GitHub Releases, install on macOS or Linux, verify:
1. App launches
2. Settings → Check for updates → returns "Up to date"
3. Kill `cli-proxy-api` externally → UI shows error within 8s
4. Crash via dev-only command (skip if not implemented) → next launch About shows "Last crash"

Phase 2 complete.

---

# Phase 3 — Design System & UX Polish

> Phase 3 starts after v0.1.x is published and stable for ≥1 week.

## Task 21: Design tokens → Tailwind v4 `@theme`

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Mirror CSS vars into Tailwind theme**

Tailwind v4 supports CSS-first config. In `src/index.css` after the `:root` token block, add:

```css
@import "tailwindcss";

@theme {
  --color-bg: var(--c-bg);
  --color-surface: var(--c-surface);
  --color-raised: var(--c-raised);
  --color-border: var(--c-border);
  --color-border-sub: var(--c-border-sub);
  --color-text-1: var(--c-text-1);
  --color-text-2: var(--c-text-2);
  --color-text-3: var(--c-text-3);
  --color-accent: var(--c-accent);
  --color-accent-bg: var(--c-accent-bg);
  --color-accent-dim: var(--c-accent-dim);
  --color-run: var(--c-run);
  --color-start: var(--c-start);
  --color-err: var(--c-err);
  --color-err-bg: var(--c-err-bg);
  --color-hover: var(--c-hover);
}
```

This gives `bg-bg`, `text-text-1`, `border-border-sub` etc.

- [ ] **Step 2: Verify Tailwind compiles**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "style: expose CSS color tokens to Tailwind v4 @theme"
```

---

## Task 22: Build base UI components

**Files:**
- Create: `src/components/ui/index.ts`
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/Input.tsx`
- Create: `src/components/ui/NumberInput.tsx`
- Create: `src/components/ui/Toggle.tsx`
- Create: `src/components/ui/Card.tsx`
- Create: `src/components/ui/Section.tsx`
- Create: `src/components/ui/Row.tsx`
- Create: `src/components/ui/Pill.tsx`
- Create: `src/components/ui/Toast.tsx`
- Create: `src/components/ui/Modal.tsx`
- Create: `src/components/ui/__tests__/Button.test.tsx`

- [ ] **Step 1: Button with cva**

`Button.tsx`:

```tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const button = cva(
  'inline-flex items-center justify-center gap-1 rounded-md font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-accent-bg text-accent border border-accent-dim hover:bg-accent/15',
        ghost:   'bg-transparent text-text-3 hover:bg-hover hover:text-text-1',
        danger:  'bg-err-bg text-err border border-err/40 hover:bg-err/15',
      },
      size: {
        sm: 'h-6 px-2 text-[11px]',
        md: 'h-8 px-3 text-xs',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(button({ variant, size }), className)} {...props} />
  ),
)
Button.displayName = 'Button'
```

- [ ] **Step 2: Build the rest**

Use the same cva pattern. Each component ≤ 60 lines. Index file re-exports them.

- [ ] **Step 3: Test Button variants**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from '../Button'

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click</Button>)
    expect(screen.getByRole('button', { name: 'Click' })).toBeInTheDocument()
  })
  it('applies danger variant class', () => {
    render(<Button variant="danger">x</Button>)
    expect(screen.getByRole('button')).toHaveClass('bg-err-bg')
  })
})
```

- [ ] **Step 4: Verify + commit**

```bash
npm run lint && npm run typecheck && npm run test:run && npm run build
git add src/components/ui
git commit -m "feat(ui): add base components — Button, Input, Toggle, Card, Section, Row, Pill, Toast, Modal"
```

---

## Task 23: Migrate Settings page to UI components

Replace inline-styled `Toggle` / `Section` / `Row` in `src/pages/Settings.tsx` with imports from `@/components/ui`. Behavior unchanged.

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Replace local definitions with imports**
- [ ] **Step 2: Replace inline `<button>` styles with `<Button>` variants**
- [ ] **Step 3: Replace `<input type="number">` with `<NumberInput>`**
- [ ] **Step 4: Verify visual parity (dev run)**
- [ ] **Step 5: Verify + commit**

```bash
npm run lint && npm run typecheck && npm run test:run && npm run build
git add src/pages/Settings.tsx
git commit -m "refactor(settings): use shared UI components"
```

---

## Task 24: Migrate Logs page + add virtual list

**Files:**
- Modify: `package.json` (add `@tanstack/react-virtual`)
- Modify: `src/components/LogList.tsx`
- Modify: `src/pages/Logs.tsx`

- [ ] **Step 1: Install**

```bash
npm install @tanstack/react-virtual
```

- [ ] **Step 2: Rewrite `LogList.tsx`**

```tsx
import { useRef, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { LogLine } from '@/stores/logs'

interface Props { lines: LogLine[]; autoScroll: boolean }

export function LogList({ lines, autoScroll }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const v = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 18,
    overscan: 20,
  })

  useEffect(() => {
    if (!autoScroll || lines.length === 0) return
    v.scrollToIndex(lines.length - 1, { align: 'end' })
  }, [lines.length, autoScroll, v])

  return (
    <div ref={parentRef} style={{ flex: 1, overflow: 'auto' }} className="font-log">
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((item) => {
          const l = lines[item.index]
          return (
            <div
              key={item.key}
              style={{
                position: 'absolute', top: 0, left: 0, width: '100%',
                transform: `translateY(${item.start}px)`,
                height: item.size, padding: '0 12px',
                color: l.level === 'stderr' ? 'var(--c-err)' : 'var(--c-text-2)',
                fontSize: 11, lineHeight: '18px', whiteSpace: 'pre',
              }}
            >
              {l.text}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add export-to-file button**

In `Logs.tsx` toolbar, add a Download button that calls a Rust command `export_logs(path)` (writes current visible lines to a file at user-chosen path via `dialog` plugin). Keep simple: write to `data_dir/logs/export-{ts}.log`.

- [ ] **Step 4: Verify + commit**

```bash
npm run lint && npm run typecheck && npm run test:run && npm run build
git add .
git commit -m "feat(logs): virtualize log list and add export-to-file"
```

---

## Task 25: Dashboard — webview toolbar + reload-on-error retry

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/components/CpaWebView.tsx` (expose `back/forward/zoom`)

- [ ] **Step 1: Extend `CpaWebViewHandle`**

```ts
export interface CpaWebViewHandle {
  reload: () => void
  back: () => void
  forward: () => void
  copyUrl: () => void
  openExternal: () => void
  setZoom: (level: number) => void
}
```

Implement `back/forward` via `wv.eval('history.back()')` etc. `openExternal` uses `opener:open(url)`.

- [ ] **Step 2: Toolbar above webview**

In Dashboard, render a 28px-tall toolbar above the webview area (only when running):

```tsx
<div className="dashboard-toolbar">
  <Button size="sm" variant="ghost" onClick={() => wv.current?.back()}>←</Button>
  <Button size="sm" variant="ghost" onClick={() => wv.current?.forward()}>→</Button>
  <Button size="sm" variant="ghost" onClick={() => wv.current?.reload()}>⟳</Button>
  <span className="text-text-3 text-[11px] tabular-nums">{managementUrl}</span>
  <Button size="sm" variant="ghost" onClick={() => wv.current?.copyUrl()}>Copy</Button>
  <Button size="sm" variant="ghost" onClick={() => wv.current?.openExternal()}>↗</Button>
</div>
```

Adjust `SIDEBAR_W`/`STATUS_H` math in `CpaWebView` to account for the new toolbar height.

- [ ] **Step 3: Verify + commit**

```bash
npm run lint && npm run typecheck && npm run test:run && npm run build
git add .
git commit -m "feat(dashboard): add webview toolbar (back/fwd/reload/copy/open external)"
```

---

## Task 26: Migrate About + FirstRunSetup to UI components

Same pattern as Task 23. Trim About to ~150 lines: keep version info, links, last-panic block, optional credits.

- [ ] **Step 1: Refactor About.tsx**
- [ ] **Step 2: Refactor FirstRunSetup.tsx (visual only; mirror sources land in Task 33)**
- [ ] **Step 3: Verify + commit**

```bash
npm run lint && npm run typecheck && npm run test:run && npm run build
git add src/pages/About.tsx src/components/FirstRunSetup.tsx
git commit -m "refactor: migrate About and FirstRunSetup to shared UI"
```

---

## Task 27: `theme: 'system'`

**Files:**
- Modify: `src/stores/settings.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Extend Theme type**

```ts
export type Theme = 'light' | 'dark' | 'system'
```

- [ ] **Step 2: Resolve effective theme**

In `App.tsx`:

```ts
useEffect(() => {
  const apply = () => {
    const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    const eff = theme === 'system' ? sys : theme
    document.documentElement.setAttribute('data-theme', eff)
  }
  apply()
  const mql = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => { if (theme === 'system') apply() }
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}, [theme])
```

- [ ] **Step 3: Sidebar toggle cycles through 3 states**

light → dark → system → light. Show sun/moon/laptop icon accordingly.

- [ ] **Step 4: Verify + commit**

```bash
npm run lint && npm run typecheck && npm run test:run && npm run build
git add .
git commit -m "feat: theme: 'system' option that follows OS"
```

---

## Task 28: a11y polish

**Files:**
- Modify: `src/index.css` (focus-visible)
- Modify: `src/components/Sidebar.tsx` (arrow key nav, aria-labels)
- Modify: status-dot rendering sites (aria-label)
- Add devDep: `axe-core` (manual run only, not in CI to avoid flakiness)

- [ ] **Step 1: Global focus styles**

In `index.css`:

```css
:focus-visible {
  outline: 2px solid var(--c-accent);
  outline-offset: 2px;
  border-radius: 4px;
}
```

- [ ] **Step 2: Sidebar arrow key nav**

In `Sidebar.tsx` add an `onKeyDown` on the nav container that moves focus among nav buttons via `↑/↓`.

- [ ] **Step 3: aria-labels**

Every status dot: `aria-label={statusText(status)}`.

- [ ] **Step 4: Verify**

Manual: Tab through the app — every interactive element shows a focus ring. Run `npx @axe-core/cli http://localhost:1420` against `npm run dev`; record output, fix critical findings, commit.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "a11y: focus-visible, aria-labels, keyboard nav for sidebar"
```

---

## Task 29: i18n locales restructure + ICU

**Files:**
- Move: `src/lib/i18n.ts` → `src/locales/zh.ts` + `src/locales/en.ts` + `src/locales/index.ts`
- Modify: any consumer (`useT()` should keep working)
- Add devDep: `intl-messageformat`

- [ ] **Step 1: Split**

`src/locales/zh.ts` exports the existing zh dict. Same for en. `index.ts`:

```ts
import { zh } from './zh'
import { en } from './en'
export const translations = { zh, en } as const
export type Lang = keyof typeof translations
```

- [ ] **Step 2: Rewrite `useT()`**

In `src/lib/i18n.ts` keep just the hook:

```ts
import { translations } from '@/locales'
import { useSettingsStore } from '@/stores/settings'
export type T = typeof translations.en
export function useT(): T {
  return translations[useSettingsStore((s) => s.lang)]
}
```

- [ ] **Step 3: Plural with ICU**

Convert plural strings to ICU. Example for `lines(n)`:

```ts
// in zh.ts/en.ts:
lines: '{n, plural, one {# line} other {# lines}}'
```

Add a helper:

```ts
import IntlMessageFormat from 'intl-messageformat'
export function fmt(template: string, lang: Lang, vars: Record<string, unknown>) {
  return new IntlMessageFormat(template, lang).format(vars) as string
}
```

Update existing call sites to use `fmt(t.logs.lines, lang, { n: count })`.

- [ ] **Step 4: Verify (i18n parity test still green)**

```bash
npm run test:run
```

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "refactor(i18n): split locales into per-language files; add ICU plural support"
```

---

## Task 30: Config editor — backup + Rust-side YAML validation

**Files:**
- Modify: `src-tauri/src/commands/config.rs` — `write_config_yaml` validates + backs up
- Add: helpers in `app_config.rs`

- [ ] **Step 1: Backup before write**

In `commands/config.rs::write_config_yaml`, before writing:

```rust
// Validate
serde_yaml::from_str::<serde_yaml::Value>(&content).map_err(|e| format!("YAML parse error: {e}"))?;

// Backup
let backups = app_config::backups_dir(&app);
std::fs::create_dir_all(&backups).map_err(|e| e.to_string())?;
let target = app_config::config_yaml_path(&app);
if target.exists() {
    let ts = chrono::Local::now().format("%Y%m%dT%H%M%S");
    let backup_path = backups.join(format!("config.yaml.{ts}"));
    let _ = std::fs::copy(&target, &backup_path);
    prune_backups(&backups, 10);
}
```

`prune_backups`:

```rust
fn prune_backups(dir: &std::path::Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    files.sort_by_key(|e| e.metadata().and_then(|m| m.modified()).ok());
    while files.len() > keep {
        if let Some(old) = files.first() { let _ = std::fs::remove_file(old.path()); }
        files.remove(0);
    }
}
```

- [ ] **Step 2: List + restore commands**

```rust
#[tauri::command]
pub fn list_config_backups(app: AppHandle) -> Result<Vec<String>, String> { /* ... */ }

#[tauri::command]
pub fn restore_config_backup(app: AppHandle, name: String) -> Result<String, String> {
    // copy backup over current config; return new content
}
```

Register in `invoke_handler!`.

- [ ] **Step 3: Test**

`commands/config.rs` tests for `prune_backups` (use `tempfile`):

```bash
cargo add --dev --manifest-path src-tauri/Cargo.toml tempfile
```

- [ ] **Step 4: Verify + commit**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
git add .
git commit -m "feat(config): validate YAML on save and keep last 10 backups"
```

---

## Task 31: Config editor — Form view (5 fields)

**Files:**
- Modify: `src/pages/Settings.tsx` — add Form/YAML tabs
- Add: `src/components/ConfigForm.tsx`
- Add: Rust commands `read_config_field` / `write_config_field` (path-style YAML mutation)

- [ ] **Step 1: Rust path-based YAML mutation**

In `commands/config.rs`:

```rust
#[tauri::command]
pub fn write_config_field(app: AppHandle, path: String, value: serde_json::Value) -> Result<(), String> {
    let current = read_config_yaml(app.clone())?;
    let mut doc: serde_yaml::Value = serde_yaml::from_str(&current).map_err(|e| e.to_string())?;
    set_path(&mut doc, &path, value)?;
    let out = serde_yaml::to_string(&doc).map_err(|e| e.to_string())?;
    write_config_yaml(app, out)
}

fn set_path(doc: &mut serde_yaml::Value, path: &str, value: serde_json::Value) -> Result<(), String> {
    let parts: Vec<&str> = path.split('.').collect();
    let mut cur = doc;
    for p in &parts[..parts.len()-1] {
        cur = cur.as_mapping_mut().ok_or("not a mapping")?
            .entry(serde_yaml::Value::String((*p).to_string()))
            .or_insert(serde_yaml::Value::Mapping(Default::default()));
    }
    let last = *parts.last().unwrap();
    cur.as_mapping_mut().ok_or("not a mapping")?
        .insert(serde_yaml::Value::String(last.to_string()),
                serde_yaml::to_value(&value).map_err(|e| e.to_string())?);
    Ok(())
}
```

- [ ] **Step 2: Form component**

`ConfigForm.tsx` exposes 5 fields (`port`, `log_level`, `auth.token`, `auth.enabled`, `request_timeout_seconds`). On change, debounce 400ms then `writeConfigField(path, value)`. Show "Saved" toast.

- [ ] **Step 3: Tabs**

In `Settings.tsx` add a Tabs component (or inline) — Form vs YAML.

- [ ] **Step 4: Verify + commit**

```bash
npm run lint && npm run typecheck && npm run test:run && npm run build
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
git add .
git commit -m "feat(config): form view for top 5 fields with path-based YAML mutation"
```

---

## Task 32: YAML view with Monaco editor (lazy)

**Files:**
- Modify: `package.json` (`@monaco-editor/react`, `monaco-editor`)
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Install**

```bash
npm install @monaco-editor/react monaco-editor
```

- [ ] **Step 2: Lazy import**

```tsx
const MonacoLazy = lazy(() => import('@monaco-editor/react'))
// in YAML tab content:
<Suspense fallback={<div>Loading editor…</div>}>
  <MonacoLazy height="320" language="yaml" theme="vs-dark"
    value={yaml} onChange={(v) => setYaml(v ?? '')} />
</Suspense>
```

- [ ] **Step 3: Verify build size impact**

```bash
npm run build
ls -lh dist/assets/
```

Confirm the Monaco chunk is split (separate `*.js` file ~3MB) — Vite splits dynamic imports automatically.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(config): lazy-loaded Monaco YAML editor"
```

---

## Task 33: FirstRunSetup — mirror sources + resume

**Files:**
- Modify: `src-tauri/src/commands/updater.rs` (`download_cpa_update` accepts a list of mirrors and uses HTTP Range)
- Modify: `src/components/FirstRunSetup.tsx` (UI for mirror selection)

- [ ] **Step 1: Rust resume logic**

Track `downloaded` from existing `.partial` file size; send `Range: bytes=N-` header; append to file. On 200 (no resume) restart from 0.

- [ ] **Step 2: Mirror list**

Accept `mirrors: Vec<String>` and try in order. UI default: `["github.com", "ghproxy.com/https://github.com"]` plus a custom field.

- [ ] **Step 3: Verify**

Manual: throttle network, kill mid-download, restart — file resumes.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(setup): mirror sources + HTTP Range resume for CPA download"
```

---

## Task 34: v0.2.0 verification & tag

- [ ] **Step 1: VERIFY-ALL green**
- [ ] **Step 2: Manual smoke test on each platform you can reach**
- [ ] **Step 3: Tag**

```bash
git tag -a v0.2.0 -m "Phase 3: design system + UX polish"
git push --follow-tags
```

- [ ] **Step 4: Mark plan as complete**

Update header: `Status: Complete`. Commit.

---

# Polish patches to existing tasks

Small patches that ride on existing tasks rather than warranting their own. Apply each as part of the parent task's commit.

### Patch 15.1 — `auto_start` defaults to `false`

In Task 15 Step 1 (`Settings::default()`), set `auto_start: false`. CPA spawning a child process before the user has consented (or before a binary is present) is surprising on first launch. Show the user a clear "Start CPA" affordance in the empty-state Dashboard (already covered by Task 25). Add a one-time banner: "Auto-start is off — enable in Settings to start CPA on launch."

### Patch 19.1 — Bundle metadata + version sync

In Task 19, before triggering `tauri-action`, add a `sync-version` step:

```yaml
- name: Sync versions
  run: |
    node -e "const v=require('./package.json').version; \
      const f='src-tauri/tauri.conf.json'; \
      const j=JSON.parse(require('fs').readFileSync(f,'utf8')); \
      j.version = v; \
      require('fs').writeFileSync(f, JSON.stringify(j,null,2)+'\n');"
    sed -i.bak 's/^version = .*/version = "'$(node -p "require('./package.json').version")'"/' src-tauri/Cargo.toml && rm src-tauri/Cargo.toml.bak
```

Also ensure `tauri.conf.json` carries `productName`, `identifier` (`com.cpa.desktop`), `copyright`, `category`, `shortDescription`, `longDescription` — required for clean DMG/MSI metadata.

### Patch 22.1 — Global `<Toaster />` mount

Step 1 of Task 22 introduces `Toast`. Add:

```tsx
// src/components/ui/Toaster.tsx
export function Toaster() { /* portal-mounts queue from useToastStore */ }
```

Mount once in `App.tsx` so any feature can call `toast.success(...)` / `toast.error(...)` without rendering its own container. Use it in Tasks 14 (download progress), 15 (update toast), 16 (port conflict resolution), 30 (backup created).

### Patch 24.1 — Persist log filters in settings

In Task 24, store the current `levelFilter` and `searchQuery` in `useSettingsStore` with debounced (300ms) persistence to `settings.json`. Avoids losing the filter across restarts and across navigations away from the Logs page.

```ts
const { logFilter, setLogFilter } = useSettingsStore()
```

Add `logFilter: { levels: LogLevel[]; query: string }` to `Settings` (Rust + TS). Bump `schema_version` if Task 8b's bump hasn't already happened.

### Patch 33.1 — Resumable download retries on transient failure

In Task 33 Step 2, when the Range request returns a 5xx or the stream errors, retry up to 3 times with exponential backoff (1s, 2s, 4s) before surfacing a user-actionable "Retry" button via the global `<Toaster />` (Patch 22.1). Cap total elapsed retry time at 30s; afterward, the user must click Retry.

```rust
let mut backoff = std::time::Duration::from_secs(1);
for attempt in 0..3 {
    match try_download_chunk(&url, range).await {
        Ok(b) => return Ok(b),
        Err(e) if attempt < 2 => {
            log::warn!("download chunk failed (attempt {attempt}): {e}; retrying in {:?}", backoff);
            tokio::time::sleep(backoff).await;
            backoff *= 2;
        }
        Err(e) => return Err(e),
    }
}
```

---

# Self-review checklist

Run after writing this plan; fix issues inline.

1. **Spec coverage:** every spec section §2.x and §3.x maps to a Task above:
   - §2.1 → Tasks 1, 2, 3, 4
   - §2.2 → Tasks 0, 5, 5b, 6, 7
   - §2.3 → Tasks 11, 11b, 12, 12b, 13
   - §2.4 → Tasks 14, 15 (+ Patch 15.1)
   - §2.5 → Tasks 8, 8b, 9, 9b, 10, 16, 17
   - §2.6 → Tasks 18, 19 (+ Patch 19.1)
   - §2.7 → Task 20
   - §3.1 → Tasks 21, 22 (+ Patch 22.1)
   - §3.2 → Tasks 30, 31, 32
   - §3.3 → Tasks 23, 24 (+ Patch 24.1), 25, 26
   - §3.4 → Task 29
   - §3.5 → Task 28
   - §3.6 → Tasks 33 (+ Patch 33.1), 34
   - §5b global CI rule → applied as VERIFY-ALL block, enforced per-task
   - **Polish items added 2026-04-27:** Tasks 5b, 8b, 9b, 11b, 12b, plus Patches 15.1, 19.1, 22.1, 24.1, 33.1 (16 items, see commit history)

2. **Placeholder scan:** no `TBD`/`TODO`/"implement later" in committed code paths. Two acceptable comment markers:
   - `// adapt to existing variables` — instruction to engineer about call-site mapping, not unfinished code.
   - `<owner>` placeholder in `tauri.conf.json` plugin endpoint — Step 3 of Task 14 explicitly stops the engineer until they fill it.

3. **Type/symbol consistency:**
   - `CpaStatus` referenced in Tasks 4, 5, 16; assumed `Serialize + Clone + PartialEq + Debug` (Task 3 ensures Serialize).
   - `app_config::{logs_dir, backups_dir, settings_path, data_dir, config_yaml_path}` all reused; `logs_dir` introduced Task 11, `backups_dir` Task 30, `settings_path` Task 11.
   - `CpaWebViewHandle` extended in Task 25; original signature in Task 9 only references `reload`, fine.
   - `AppSettings` (TS) gains `lastPanic`, `autoCheckAppUpdates` in Tasks 13, 15. Rust serde uses `rename_all = "camelCase"` from Task 13 step 1.
