# CPA Desktop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a cross-platform desktop app (Tauri v2 + Rust + React) that manages the CLIProxyAPI binary lifecycle — auto-download, silent background start, log streaming, and one-click updates — eliminating the Windows "black CMD window" pain point.

**Architecture:** Rust backend manages the CPA child process (hidden on Windows via `CREATE_NO_WINDOW`), polls health, captures stdout/stderr, and emits events to the React frontend via Tauri's event system. The management UI is loaded via a Tauri child webview (same technique as eNkru/cpa-ui). System tray keeps the app alive when the window is closed.

**Tech Stack:** Tauri v2 (unstable feature for child webview) · React 18 + TypeScript + Vite · Tailwind CSS v4 · shadcn/ui · Zustand · Rust (tokio, reqwest, zip, flate2, tar, serde_yaml)

---

## Reference Projects

- **eNkru/cpa-ui** — webview technique: `new Webview(win, LABEL, {url, x, y, width, height})` with `tauri = { version = "2", features = ["unstable"] }`. Close button minimizes instead of quits.
- **CLIProxyAPI releases** — asset pattern: `CLIProxyAPI_{version}_{os}_{arch}.{ext}` where os=windows/darwin/linux, arch=amd64/arm64, ext=zip(Windows)/tar.gz(others). Only binary + docs in archive (no static/). Static panel auto-downloaded by CPA itself.
- **Default port**: 8317. Config: `config.yaml` in CPA working directory.

---

## Directory Layout (Final)

```
CPA-Desktop/
├── docs/plans/                     # this file lives here
├── src-tauri/
│   ├── src/
│   │   ├── main.rs                 # windows_subsystem = "windows"
│   │   ├── lib.rs                  # tauri builder, plugin registration
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── cpa.rs              # start/stop/status/get_port
│   │   │   ├── updater.rs          # check_cpa_update/download_cpa_update
│   │   │   └── config.rs           # read/write config.yaml, app settings
│   │   ├── cpa_manager.rs          # Arc<Mutex<CpaState>>, spawn, kill, health
│   │   ├── log_stream.rs           # stdout/stderr → ring buffer → events
│   │   └── tray.rs                 # tray icon, menu, status update
│   ├── capabilities/default.json
│   ├── icons/
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/
│   ├── main.tsx
│   ├── App.tsx                     # sidebar + page router
│   ├── pages/
│   │   ├── Dashboard.tsx           # child webview + overlays
│   │   ├── Logs.tsx                # virtual log list
│   │   ├── Settings.tsx            # port, auto-start, config.yaml editor
│   │   └── About.tsx               # versions + CPA update
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── StatusBar.tsx           # CPA status, version, port
│   │   ├── CpaWebView.tsx          # child webview manager (≈ eNkru WebViewArea)
│   │   └── LogList.tsx             # virtualized log rows
│   ├── stores/
│   │   ├── cpa.ts                  # CPA status: idle/starting/running/stopped/error
│   │   └── logs.ts                 # log lines ring buffer
│   └── lib/
│       └── tauri.ts                # typed wrappers for invoke() calls
├── package.json
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.ts
```

---

## App Data Directory Layout (Runtime)

```
# Windows:  %APPDATA%\cpa-desktop\
# macOS:    ~/Library/Application Support/cpa-desktop/
# Linux:    ~/.local/share/cpa-desktop/

cpa-desktop/
├── bin/
│   └── cli-proxy-api[.exe]     # managed CPA binary
├── data/                       # CPA working directory
│   ├── config.yaml             # bootstrapped from config.example.yaml on first run
│   └── static/                 # auto-downloaded by CPA itself (we don't touch this)
├── app-settings.json           # { "port": 8317, "autoStart": true, "cpaVersion": "6.9.38" }
└── cpa.log                     # optional: last session log dump
```

---

## Task 1: Initialize Tauri v2 Project

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `src/main.tsx`
- Create: `index.html`

**Step 1: Scaffold with create-tauri-app**

```bash
cd D:/TuDou/CPA-Desktop
npm create tauri-app@latest . -- --template react-ts --manager npm --force
```

Expected: project files created.

**Step 2: Install frontend dependencies**

```bash
npm install
npm install zustand @tauri-apps/api @tauri-apps/plugin-shell
npm install -D tailwindcss @tailwindcss/vite
npm install lucide-react clsx tailwind-merge
```

**Step 3: Install shadcn/ui**

```bash
npx shadcn@latest init
# choose: TypeScript, default style, slate, yes CSS variables
npx shadcn@latest add button badge separator scroll-area tabs toast
```

**Step 4: Update `src-tauri/Cargo.toml`**

Replace contents:

```toml
[package]
name = "cpa-desktop"
version = "0.1.0"
description = "CPA Desktop - CLIProxyAPI manager"
edition = "2021"

[lib]
name = "cpa_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["unstable", "tray-icon"] }
tauri-plugin-shell = "2"
tauri-plugin-fs = "2"
tauri-plugin-notification = "2"
tauri-plugin-http = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml = "0.9"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json", "stream"] }
zip = "2"
flate2 = "1"
tar = "0.4"
futures-util = "0.3"
log = "0.4"
chrono = { version = "0.4", features = ["serde"] }
```

**Step 5: Add `windows_subsystem` to `src-tauri/src/main.rs`**

```rust
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    cpa_desktop_lib::run()
}
```

**Step 6: Update `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "CPA Desktop",
  "version": "0.1.0",
  "identifier": "me.router-for.cpa-desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "CPA Desktop",
        "width": 1280,
        "height": 800,
        "minWidth": 900,
        "minHeight": 600,
        "resizable": true,
        "decorations": true
      }
    ],
    "trayIcon": {
      "iconPath": "icons/tray.png",
      "iconAsTemplate": true
    },
    "security": {
      "csp": "default-src 'self'; connect-src 'self' http://localhost:* https://*; img-src 'self' data: http://localhost:* https://*; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "nsis", "dmg", "app", "appimage", "deb"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

**Step 7: Configure Tailwind in `vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
})
```

**Step 8: Verify dev server starts**

```bash
npm run tauri dev
```

Expected: window opens showing Vite default page. Close it.

**Step 9: Commit**

```bash
git add -A
git commit -m "feat: scaffold Tauri v2 + React + Tailwind + shadcn/ui"
```

---

## Task 2: Rust — App Data & Settings Module

**Files:**
- Create: `src-tauri/src/app_config.rs`
- Modify: `src-tauri/src/lib.rs`

**Goal:** Central module to resolve app data paths and read/write `app-settings.json`.

**Step 1: Create `src-tauri/src/app_config.rs`**

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub port: u16,
    pub auto_start: bool,
    pub cpa_version: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self { port: 8317, auto_start: true, cpa_version: None }
    }
}

pub fn app_data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path().app_data_dir().expect("app data dir unavailable")
}

pub fn bin_dir(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("bin")
}

pub fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("data")
}

pub fn cpa_binary_path(app: &tauri::AppHandle) -> PathBuf {
    let name = if cfg!(target_os = "windows") {
        "cli-proxy-api.exe"
    } else {
        "cli-proxy-api"
    };
    bin_dir(app).join(name)
}

pub fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    app_data_dir(app).join("app-settings.json")
}

pub fn config_yaml_path(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("config.yaml")
}

pub fn load_settings(app: &tauri::AppHandle) -> AppSettings {
    let path = settings_path(app);
    if let Ok(content) = std::fs::read_to_string(&path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        AppSettings::default()
    }
}

pub fn save_settings(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

pub fn ensure_dirs(app: &tauri::AppHandle) -> Result<(), String> {
    for dir in [bin_dir(app), data_dir(app)] {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Bootstrap config.yaml from embedded example if not present.
pub fn ensure_config_yaml(app: &tauri::AppHandle) -> Result<(), String> {
    let path = config_yaml_path(app);
    if path.exists() {
        return Ok(());
    }
    let example = include_str!("../../assets/config.example.yaml");
    std::fs::write(&path, example).map_err(|e| e.to_string())
}
```

**Step 2: Add `config.example.yaml` as embedded asset**

Copy `config.example.yaml` from CLIProxyAPI into `assets/config.example.yaml` (create the dir):

```bash
mkdir -p src-tauri/assets
curl -sL https://raw.githubusercontent.com/router-for-me/CLIProxyAPI/main/config.example.yaml \
  -o src-tauri/assets/config.example.yaml
```

**Step 3: Wire into `src-tauri/src/lib.rs`**

```rust
mod app_config;
mod cpa_manager;
mod log_stream;
mod tray;
mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            app_config::ensure_dirs(app.handle())?;
            app_config::ensure_config_yaml(app.handle())?;
            // further setup in later tasks
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // filled in as tasks progress
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri app")
}
```

**Step 4: Add Tauri plugin capabilities to `src-tauri/capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capabilities",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:event:default",
    "core:window:default",
    "core:webview:default",
    "shell:default",
    "fs:default",
    "fs:allow-app-read-recursive",
    "fs:allow-app-write-recursive",
    "notification:default",
    "http:default"
  ]
}
```

**Step 5: Build to verify compilation**

```bash
cd src-tauri && cargo check
```

Expected: no errors (warnings ok).

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(rust): app data dirs and settings module"
```

---

## Task 3: Rust — CPA Binary Downloader

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/updater.rs`

**Goal:** Detect platform/arch, query GitHub releases API, download and extract CPA binary with progress events.

**Step 1: Create `src-tauri/src/commands/mod.rs`**

```rust
pub mod updater;
pub mod cpa;
pub mod config;
```

**Step 2: Create `src-tauri/src/commands/updater.rs`**

```rust
use crate::app_config;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Deserialize)]
pub struct ReleaseInfo {
    pub tag_name: String,
    pub browser_download_url: String,
}

#[derive(Debug, Serialize)]
pub struct UpdateCheckResult {
    pub current_version: Option<String>,
    pub latest_version: String,
    pub update_available: bool,
    pub download_url: String,
}

fn asset_name(version: &str) -> String {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        other => other,
    };
    let ext = if cfg!(target_os = "windows") { "zip" } else { "tar.gz" };
    // strip leading 'v' from version for asset name
    let ver = version.trim_start_matches('v');
    format!("CLIProxyAPI_{ver}_{os}_{arch}.{ext}")
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    assets: Vec<GhAsset>,
}

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

#[tauri::command]
pub async fn check_cpa_update(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let settings = app_config::load_settings(&app);
    let client = reqwest::Client::builder()
        .user_agent("CPA-Desktop/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    let release: GhRelease = client
        .get("https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let name = asset_name(&release.tag_name);
    let asset = release
        .assets
        .iter()
        .find(|a| a.name == name)
        .ok_or_else(|| format!("No asset found for: {name}"))?;

    let current = settings.cpa_version.clone();
    let update_available = current.as_deref().map(|v| v != release.tag_name).unwrap_or(true);

    Ok(UpdateCheckResult {
        current_version: current,
        latest_version: release.tag_name,
        update_available,
        download_url: asset.browser_download_url.clone(),
    })
}

#[tauri::command]
pub async fn download_cpa_update(
    app: AppHandle,
    download_url: String,
    version: String,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("CPA-Desktop/0.1")
        .build()
        .map_err(|e| e.to_string())?;

    // Download with progress
    let resp = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        buf.extend_from_slice(&chunk);
        if total > 0 {
            let _ = app.emit("cpa:download-progress", (downloaded, total));
        }
    }

    // Extract binary
    let bin_dir = app_config::bin_dir(&app);
    std::fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;

    let binary_name = if cfg!(target_os = "windows") {
        "cli-proxy-api.exe"
    } else {
        "cli-proxy-api"
    };

    if download_url.ends_with(".zip") {
        extract_zip(&buf, binary_name, &bin_dir)?;
    } else {
        extract_targz(&buf, binary_name, &bin_dir)?;
    }

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let bin_path = bin_dir.join(binary_name);
        let mut perms = std::fs::metadata(&bin_path)
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&bin_path, perms).map_err(|e| e.to_string())?;
    }

    // Save version to settings
    let mut settings = app_config::load_settings(&app);
    settings.cpa_version = Some(version);
    app_config::save_settings(&app, &settings)?;

    let _ = app.emit("cpa:download-complete", ());
    Ok(())
}

fn extract_zip(data: &[u8], binary_name: &str, dest: &std::path::Path) -> Result<(), String> {
    use std::io::Read;
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        // Match just the filename, regardless of path inside zip
        let file_name = std::path::Path::new(file.name())
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();

        if file_name == binary_name {
            let out_path = dest.join(binary_name);
            let mut content = Vec::new();
            file.read_to_end(&mut content).map_err(|e| e.to_string())?;
            std::fs::write(&out_path, content).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err(format!("{binary_name} not found in zip"))
}

fn extract_targz(data: &[u8], binary_name: &str, dest: &std::path::Path) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use std::io::Read;
    use tar::Archive;

    let cursor = std::io::Cursor::new(data);
    let gz = GzDecoder::new(cursor);
    let mut archive = Archive::new(gz);

    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?;
        let file_name = path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();

        if file_name == binary_name {
            let out_path = dest.join(binary_name);
            let mut content = Vec::new();
            entry.read_to_end(&mut content).map_err(|e| e.to_string())?;
            std::fs::write(&out_path, content).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err(format!("{binary_name} not found in tar.gz"))
}
```

**Step 3: Register commands in `lib.rs`**

```rust
.invoke_handler(tauri::generate_handler![
    commands::updater::check_cpa_update,
    commands::updater::download_cpa_update,
])
```

**Step 4: Cargo check**

```bash
cd src-tauri && cargo check
```

Expected: compiles successfully.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(rust): CPA binary downloader with platform detection"
```

---

## Task 4: Rust — CPA Process Manager

**Files:**
- Create: `src-tauri/src/cpa_manager.rs`
- Create: `src-tauri/src/commands/cpa.rs`
- Modify: `src-tauri/src/lib.rs`

**Goal:** Start/stop CPA as a hidden subprocess, poll health, detect pre-running instance.

**Step 1: Create `src-tauri/src/cpa_manager.rs`**

```rust
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CpaStatus {
    Idle,
    Starting,
    Running,
    Stopped,
    Error(String),
}

pub struct CpaState {
    pub process: Option<Child>,
    pub status: CpaStatus,
    pub port: u16,
}

impl CpaState {
    pub fn new(port: u16) -> Self {
        Self { process: None, status: CpaStatus::Idle, port }
    }
}

pub type SharedCpaState = Arc<Mutex<CpaState>>;

pub fn new_shared_state(port: u16) -> SharedCpaState {
    Arc::new(Mutex::new(CpaState::new(port)))
}

/// Spawn CPA. Returns Err if binary missing or spawn fails.
pub fn spawn_cpa(
    binary_path: &PathBuf,
    working_dir: &PathBuf,
    state: &SharedCpaState,
) -> Result<(), String> {
    if !binary_path.exists() {
        return Err("CPA binary not found. Please download it first.".into());
    }

    let mut cmd = Command::new(binary_path);
    cmd.current_dir(working_dir);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    // Windows: hide the console window
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn().map_err(|e| format!("Failed to spawn CPA: {e}"))?;

    let mut s = state.lock().unwrap();
    s.process = Some(child);
    s.status = CpaStatus::Starting;
    Ok(())
}

/// Kill CPA process if running.
pub fn kill_cpa(state: &SharedCpaState) {
    let mut s = state.lock().unwrap();
    if let Some(mut child) = s.process.take() {
        let _ = child.kill();
    }
    s.status = CpaStatus::Stopped;
}

/// Non-blocking check if process is still alive.
pub fn check_process_alive(state: &SharedCpaState) -> bool {
    let mut s = state.lock().unwrap();
    if let Some(child) = s.process.as_mut() {
        match child.try_wait() {
            Ok(None) => true,         // still running
            Ok(Some(_)) | Err(_) => { // exited
                s.status = CpaStatus::Stopped;
                false
            }
        }
    } else {
        false
    }
}

/// HTTP health check — returns true if CPA is responding on the given port.
pub async fn health_check(port: u16) -> bool {
    let url = format!("http://localhost:{port}/");
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .ok()
        .and_then(|c| Some(c.get(&url).send()))
        .is_some_and(|f| {
            tokio::runtime::Handle::current()
                .block_on(async { f.await.is_ok() })
        })
}

/// Async health check (preferred).
pub async fn health_check_async(port: u16) -> bool {
    let url = format!("http://localhost:{port}/");
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .map(|c| c.get(&url).send())
        .map(|f| async { f.await.is_ok() })
        .map(|fut| futures_util::FutureExt::into_future(std::pin::pin!(fut)))
        .map_or(false, |_| true) // simplified; use the command version below
}
```

**Step 2: Create `src-tauri/src/commands/cpa.rs`**

```rust
use crate::{app_config, cpa_manager};
use crate::cpa_manager::{CpaStatus, SharedCpaState};
use tauri::{AppHandle, Emitter, State};
use tokio::time::{sleep, Duration};

#[tauri::command]
pub async fn start_cpa(
    app: AppHandle,
    state: State<'_, SharedCpaState>,
) -> Result<(), String> {
    let port = {
        let s = state.lock().unwrap();
        if s.status == CpaStatus::Running {
            return Ok(());
        }
        s.port
    };

    // Check if already running externally
    if is_already_running(port).await {
        let mut s = state.lock().unwrap();
        s.status = CpaStatus::Running;
        let _ = app.emit("cpa:status", CpaStatus::Running);
        return Ok(());
    }

    let binary = app_config::cpa_binary_path(&app);
    let working_dir = app_config::data_dir(&app);

    cpa_manager::spawn_cpa(&binary, &working_dir, &state)?;
    let _ = app.emit("cpa:status", CpaStatus::Starting);

    // Spawn health-check loop in background
    let app2 = app.clone();
    let state2 = state.inner().clone();
    tokio::spawn(async move {
        for _ in 0..30 {
            sleep(Duration::from_secs(1)).await;
            if is_already_running(port).await {
                let mut s = state2.lock().unwrap();
                s.status = CpaStatus::Running;
                let _ = app2.emit("cpa:status", CpaStatus::Running);
                return;
            }
        }
        // Timeout — mark error
        let mut s = state2.lock().unwrap();
        s.status = CpaStatus::Error("CPA failed to start within 30s".into());
        let _ = app2.emit("cpa:status", s.status.clone());
    });

    Ok(())
}

#[tauri::command]
pub fn stop_cpa(
    app: AppHandle,
    state: State<'_, SharedCpaState>,
) -> Result<(), String> {
    cpa_manager::kill_cpa(&state);
    let _ = app.emit("cpa:status", CpaStatus::Stopped);
    Ok(())
}

#[tauri::command]
pub fn get_cpa_status(state: State<'_, SharedCpaState>) -> CpaStatus {
    state.lock().unwrap().status.clone()
}

#[tauri::command]
pub fn get_cpa_port(app: AppHandle) -> u16 {
    app_config::load_settings(&app).port
}

#[tauri::command]
pub async fn check_cpa_running(state: State<'_, SharedCpaState>) -> bool {
    let port = state.lock().unwrap().port;
    is_already_running(port).await
}

async fn is_already_running(port: u16) -> bool {
    let url = format!("http://localhost:{port}/");
    reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .ok()
        .map(|c| c.get(&url).send())
        .is_some_and(|f| tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async { f.await.is_ok() })
        }))
}
```

**Step 3: Register managed state and commands in `lib.rs`**

```rust
use cpa_manager::new_shared_state;

// In setup():
let settings = app_config::load_settings(app.handle());
let cpa_state = new_shared_state(settings.port);
app.manage(cpa_state.clone());

// Auto-start if configured
if settings.auto_start {
    let app2 = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let state = app2.state::<cpa_manager::SharedCpaState>();
        let _ = commands::cpa::start_cpa(app2, state).await;
    });
}

// In invoke_handler, add:
commands::cpa::start_cpa,
commands::cpa::stop_cpa,
commands::cpa::get_cpa_status,
commands::cpa::get_cpa_port,
commands::cpa::check_cpa_running,
```

**Step 4: Cargo check**

```bash
cd src-tauri && cargo check
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(rust): CPA process manager - start/stop/health-check"
```

---

## Task 5: Rust — Log Stream

**Files:**
- Create: `src-tauri/src/log_stream.rs`
- Modify: `src-tauri/src/cpa_manager.rs` (extract stdio before storing Child)

**Goal:** Capture CPA stdout/stderr, store in ring buffer, emit to frontend as events.

**Step 1: Create `src-tauri/src/log_stream.rs`**

```rust
use std::io::{BufRead, BufReader};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use chrono::Utc;
use serde::Serialize;

const RING_SIZE: usize = 2000;

#[derive(Clone, Serialize)]
pub struct LogLine {
    pub ts: String,          // ISO timestamp
    pub level: String,       // "stdout" | "stderr"
    pub text: String,
}

pub type LogBuffer = Arc<Mutex<Vec<LogLine>>>;

pub fn new_log_buffer() -> LogBuffer {
    Arc::new(Mutex::new(Vec::with_capacity(RING_SIZE)))
}

pub fn append(buf: &LogBuffer, level: &str, text: String) {
    let line = LogLine {
        ts: Utc::now().to_rfc3339(),
        level: level.to_string(),
        text,
    };
    let mut b = buf.lock().unwrap();
    if b.len() >= RING_SIZE {
        b.remove(0);
    }
    b.push(line);
}

pub fn get_all(buf: &LogBuffer) -> Vec<LogLine> {
    buf.lock().unwrap().clone()
}

/// Spawn threads to read stdout and stderr from a process and emit events.
pub fn pipe_process_output(
    app: AppHandle,
    buf: LogBuffer,
    stdout: std::process::ChildStdout,
    stderr: std::process::ChildStderr,
) {
    // stdout thread
    let app1 = app.clone();
    let buf1 = buf.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().flatten() {
            append(&buf1, "stdout", line.clone());
            let _ = app1.emit("cpa:log", LogLine {
                ts: chrono::Utc::now().to_rfc3339(),
                level: "stdout".into(),
                text: line,
            });
        }
    });

    // stderr thread
    let buf2 = buf;
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
            append(&buf2, "stderr", line.clone());
            let _ = app.emit("cpa:log", LogLine {
                ts: chrono::Utc::now().to_rfc3339(),
                level: "stderr".into(),
                text: line,
            });
        }
    });
}
```

**Step 2: Add command to get log history**

In `commands/cpa.rs`:

```rust
use crate::log_stream::{LogBuffer, LogLine};

#[tauri::command]
pub fn get_log_history(buf: State<'_, LogBuffer>) -> Vec<LogLine> {
    crate::log_stream::get_all(&buf)
}

#[tauri::command]
pub fn clear_logs(buf: State<'_, LogBuffer>) {
    buf.lock().unwrap().clear();
}
```

**Step 3: Wire in `lib.rs`**

```rust
use log_stream::new_log_buffer;

// In setup, after cpa_state:
let log_buf = new_log_buffer();
app.manage(log_buf);

// In invoke_handler, add:
commands::cpa::get_log_history,
commands::cpa::clear_logs,
```

**Step 4: Modify `spawn_cpa` to extract stdio**

Update `cpa_manager.rs` to return piped stdio handles, and call `pipe_process_output` after spawn in `commands/cpa.rs`.

**Step 5: Cargo check**

```bash
cd src-tauri && cargo check
```

**Step 6: Commit**

```bash
git add -A
git commit -m "feat(rust): log stream - stdout/stderr capture with ring buffer"
```

---

## Task 6: Rust — Config Commands & System Tray

**Files:**
- Create: `src-tauri/src/commands/config.rs`
- Create: `src-tauri/src/tray.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Create `src-tauri/src/commands/config.rs`**

```rust
use crate::app_config::{self, AppSettings};
use tauri::AppHandle;

#[tauri::command]
pub fn get_settings(app: AppHandle) -> AppSettings {
    app_config::load_settings(&app)
}

#[tauri::command]
pub fn save_settings_cmd(app: AppHandle, settings: AppSettings) -> Result<(), String> {
    app_config::save_settings(&app, &settings)
}

#[tauri::command]
pub fn read_config_yaml(app: AppHandle) -> Result<String, String> {
    let path = app_config::config_yaml_path(&app);
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_config_yaml(app: AppHandle, content: String) -> Result<(), String> {
    // Validate it parses as YAML before writing
    serde_yaml::from_str::<serde_yaml::Value>(&content)
        .map_err(|e| format!("Invalid YAML: {e}"))?;
    let path = app_config::config_yaml_path(&app);
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let dir = app_config::data_dir(&app);
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

**Step 2: Create `src-tauri/src/tray.rs`**

```rust
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItemBuilder::new("Open Dashboard").id("show").build(app)?;
    let quit = MenuItemBuilder::new("Quit").id("quit").build(app)?;

    let menu = MenuBuilder::new(app).item(&show).separator().item(&quit).build()?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}
```

**Step 3: Hook close-to-tray in `lib.rs` setup**

```rust
// Inside setup():
tray::setup_tray(app.handle()).ok();

if let Some(window) = app.get_webview_window("main") {
    let win = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = win.hide();
        }
    });
}
```

**Step 4: macOS reopen handler**

```rust
.build(tauri::generate_context!())
.expect("error running tauri app")
.run(|app, event| {
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Reopen { .. } = event {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
});
```

**Step 5: Register all new commands in `lib.rs`**

```rust
commands::config::get_settings,
commands::config::save_settings_cmd,
commands::config::read_config_yaml,
commands::config::write_config_yaml,
commands::config::open_data_dir,
```

**Step 6: Cargo check**

```bash
cd src-tauri && cargo check
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat(rust): config commands + system tray + close-to-tray"
```

---

## Task 7: Frontend — TypeScript Command Wrappers

**Files:**
- Create: `src/lib/tauri.ts`
- Create: `src/stores/cpa.ts`
- Create: `src/stores/logs.ts`

**Step 1: Create `src/lib/tauri.ts`**

```typescript
import { invoke } from '@tauri-apps/api/core'

export interface AppSettings {
  port: number
  autoStart: boolean
  cpaVersion: string | null
}

export interface UpdateCheckResult {
  currentVersion: string | null
  latestVersion: string
  updateAvailable: boolean
  downloadUrl: string
}

export interface LogLine {
  ts: string
  level: 'stdout' | 'stderr'
  text: string
}

export type CpaStatus =
  | 'Idle'
  | 'Starting'
  | 'Running'
  | 'Stopped'
  | { Error: string }

// CPA process commands
export const startCpa = () => invoke<void>('start_cpa')
export const stopCpa = () => invoke<void>('stop_cpa')
export const getCpaStatus = () => invoke<CpaStatus>('get_cpa_status')
export const getCpaPort = () => invoke<number>('get_cpa_port')
export const checkCpaRunning = () => invoke<boolean>('check_cpa_running')

// Logs
export const getLogHistory = () => invoke<LogLine[]>('get_log_history')
export const clearLogs = () => invoke<void>('clear_logs')

// Config
export const getSettings = () => invoke<AppSettings>('get_settings')
export const saveSettings = (settings: AppSettings) =>
  invoke<void>('save_settings_cmd', { settings })
export const readConfigYaml = () => invoke<string>('read_config_yaml')
export const writeConfigYaml = (content: string) =>
  invoke<void>('write_config_yaml', { content })
export const openDataDir = () => invoke<void>('open_data_dir')

// Updater
export const checkCpaUpdate = () => invoke<UpdateCheckResult>('check_cpa_update')
export const downloadCpaUpdate = (downloadUrl: string, version: string) =>
  invoke<void>('download_cpa_update', { downloadUrl, version })
```

**Step 2: Create `src/stores/cpa.ts`**

```typescript
import { create } from 'zustand'
import { listen } from '@tauri-apps/api/event'
import type { CpaStatus } from '@/lib/tauri'
import { getCpaStatus, getCpaPort } from '@/lib/tauri'

interface CpaStore {
  status: CpaStatus
  port: number
  setStatus: (s: CpaStatus) => void
  setPort: (p: number) => void
  initialize: () => Promise<void>
}

export const useCpaStore = create<CpaStore>((set) => ({
  status: 'Idle',
  port: 8317,
  setStatus: (status) => set({ status }),
  setPort: (port) => set({ port }),
  initialize: async () => {
    const [status, port] = await Promise.all([getCpaStatus(), getCpaPort()])
    set({ status, port })
    // Listen for status changes from Rust backend
    await listen<CpaStatus>('cpa:status', (e) => set({ status: e.payload }))
  },
}))
```

**Step 3: Create `src/stores/logs.ts`**

```typescript
import { create } from 'zustand'
import { listen } from '@tauri-apps/api/event'
import type { LogLine } from '@/lib/tauri'
import { getLogHistory } from '@/lib/tauri'

const MAX_LINES = 2000

interface LogStore {
  lines: LogLine[]
  addLine: (line: LogLine) => void
  setLines: (lines: LogLine[]) => void
  clear: () => void
  initialize: () => Promise<void>
}

export const useLogStore = create<LogStore>((set, get) => ({
  lines: [],
  addLine: (line) =>
    set((s) => ({
      lines: s.lines.length >= MAX_LINES
        ? [...s.lines.slice(1), line]
        : [...s.lines, line],
    })),
  setLines: (lines) => set({ lines }),
  clear: () => set({ lines: [] }),
  initialize: async () => {
    const history = await getLogHistory()
    set({ lines: history })
    await listen<LogLine>('cpa:log', (e) => get().addLine(e.payload))
  },
}))
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(frontend): typed Tauri command wrappers and Zustand stores"
```

---

## Task 8: Frontend — App Shell & Sidebar

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/Sidebar.tsx`
- Create: `src/components/StatusBar.tsx`

**Step 1: Create `src/components/Sidebar.tsx`**

```tsx
import { LayoutDashboard, ScrollText, Settings, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Page = 'dashboard' | 'logs' | 'settings' | 'about'

const items = [
  { id: 'dashboard' as Page, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'logs' as Page, label: 'Logs', icon: ScrollText },
  { id: 'settings' as Page, label: 'Settings', icon: Settings },
  { id: 'about' as Page, label: 'About', icon: Info },
]

interface Props {
  current: Page
  onChange: (p: Page) => void
}

export function Sidebar({ current, onChange }: Props) {
  return (
    <nav className="flex flex-col w-14 bg-zinc-900 border-r border-zinc-800 py-3 gap-1 shrink-0">
      {items.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          title={label}
          onClick={() => onChange(id)}
          className={cn(
            'flex flex-col items-center justify-center h-12 w-full gap-0.5 text-[10px] transition-colors',
            current === id
              ? 'text-white bg-zinc-700'
              : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
          )}
        >
          <Icon size={18} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}
```

**Step 2: Create `src/components/StatusBar.tsx`**

```tsx
import { useCpaStore } from '@/stores/cpa'

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'Running' ? 'bg-green-500' :
    status === 'Starting' ? 'bg-yellow-500 animate-pulse' :
    'bg-zinc-500'
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
}

export function StatusBar() {
  const { status, port } = useCpaStore()
  const label =
    typeof status === 'object' ? `Error: ${status.Error}` : status

  return (
    <div className="flex items-center gap-3 px-4 h-7 text-xs text-zinc-400 bg-zinc-900 border-t border-zinc-800 shrink-0">
      <StatusDot status={typeof status === 'string' ? status : 'Error'} />
      <span>CPA: {label}</span>
      <span className="ml-auto">Port: {port}</span>
    </div>
  )
}
```

**Step 3: Rewrite `src/App.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Sidebar, type Page } from '@/components/Sidebar'
import { StatusBar } from '@/components/StatusBar'
import { Dashboard } from '@/pages/Dashboard'
import { Logs } from '@/pages/Logs'
import { SettingsPage } from '@/pages/Settings'
import { AboutPage } from '@/pages/About'
import { useCpaStore } from '@/stores/cpa'
import { useLogStore } from '@/stores/logs'

export default function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const { initialize: initCpa } = useCpaStore()
  const { initialize: initLogs } = useLogStore()

  useEffect(() => {
    initCpa()
    initLogs()
  }, [])

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      <Sidebar current={page} onChange={setPage} />
      <div className="flex flex-col flex-1 min-w-0">
        <main className="flex-1 overflow-hidden">
          {page === 'dashboard' && <Dashboard />}
          {page === 'logs' && <Logs />}
          {page === 'settings' && <SettingsPage />}
          {page === 'about' && <AboutPage />}
        </main>
        <StatusBar />
      </div>
    </div>
  )
}
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(frontend): app shell - sidebar + status bar layout"
```

---

## Task 9: Frontend — Dashboard Page (CPA WebView)

**Files:**
- Create: `src/pages/Dashboard.tsx`
- Create: `src/components/CpaWebView.tsx`

**Goal:** Full-screen child webview using same technique as eNkru/cpa-ui. Shows loading/error overlay while CPA starts.

**Step 1: Create `src/components/CpaWebView.tsx`**

```tsx
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Webview } from '@tauri-apps/api/webview'
import { getCurrentWindow, LogicalPosition, LogicalSize } from '@tauri-apps/api/window'

export interface CpaWebViewHandle {
  reload: () => void
}

interface Props {
  url: string
  visible: boolean
}

const LABEL = 'cpa-content'

async function getLogicalSize() {
  const win = getCurrentWindow()
  const size = await win.innerSize()
  const scale = await win.scaleFactor()
  // Subtract sidebar (56px) and status bar (28px) at logical pixels
  const logicalWidth = size.width / scale - 56
  const logicalHeight = size.height / scale - 28
  return { width: logicalWidth, height: logicalHeight }
}

async function closeExisting() {
  try {
    const existing = await Webview.getByLabel(LABEL)
    if (existing) await existing.close()
  } catch { /* fine */ }
}

async function spawnWebview(url: string): Promise<Webview> {
  await closeExisting()
  const win = getCurrentWindow()
  const { width, height } = await getLogicalSize()
  return new Promise((resolve, reject) => {
    const wv = new Webview(win, LABEL, {
      url,
      x: 56,   // sidebar width
      y: 0,
      width,
      height,
      focus: true,
    })
    wv.once('tauri://created', () => resolve(wv))
    wv.once('tauri://error', (e) => reject(new Error(String((e as any)?.payload ?? e))))
  })
}

export const CpaWebView = forwardRef<CpaWebViewHandle, Props>(({ url, visible }, ref) => {
  const wvRef = useRef<Webview | null>(null)
  const tokenRef = useRef(0)

  const spawn = (u: string) => {
    const token = ++tokenRef.current
    spawnWebview(u)
      .then((wv) => {
        if (tokenRef.current !== token) { wv.close(); return }
        wvRef.current = wv
        if (visible) { wv.show(); wv.setFocus().catch(() => {}) }
        else wv.hide()
      })
      .catch(console.error)
  }

  useImperativeHandle(ref, () => ({
    reload: () => spawn(url),
  }))

  useEffect(() => {
    const t = setTimeout(() => spawn(url), 100)
    return () => {
      clearTimeout(t)
      tokenRef.current++
      wvRef.current?.close()
      wvRef.current = null
    }
  }, [url])

  useEffect(() => {
    if (!wvRef.current) return
    if (visible) {
      wvRef.current.show()
      wvRef.current.setFocus().catch(() => {})
    } else {
      wvRef.current.hide()
    }
  }, [visible])

  // Handle resize
  useEffect(() => {
    const win = getCurrentWindow()
    let unlisten: (() => void) | null = null
    win.onResized(async () => {
      const wv = wvRef.current
      if (!wv) return
      const { width, height } = await getLogicalSize()
      await wv.setPosition(new LogicalPosition(56, 0))
      await wv.setSize(new LogicalSize(width, height))
    }).then((fn) => { unlisten = fn })
    return () => { unlisten?.() }
  }, [])

  return <div className="w-full h-full" />
})

CpaWebView.displayName = 'CpaWebView'
```

**Step 2: Create `src/pages/Dashboard.tsx`**

```tsx
import { useRef } from 'react'
import { CpaWebView, type CpaWebViewHandle } from '@/components/CpaWebView'
import { useCpaStore } from '@/stores/cpa'
import { startCpa } from '@/lib/tauri'
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Dashboard() {
  const { status, port } = useCpaStore()
  const webviewRef = useRef<CpaWebViewHandle>(null)

  const isRunning = status === 'Running'
  const isStarting = status === 'Starting'
  const isError = typeof status === 'object'
  const managementUrl = `http://localhost:${port}/management.html#/quota`

  return (
    <div className="relative w-full h-full bg-zinc-950">
      {/* The child webview fills behind overlays */}
      <CpaWebView
        ref={webviewRef}
        url={managementUrl}
        visible={isRunning}
      />

      {/* Starting overlay */}
      {isStarting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950">
          <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
          <p className="text-zinc-400">Starting CPA...</p>
        </div>
      )}

      {/* Error / stopped overlay */}
      {(isError || status === 'Stopped' || status === 'Idle') && !isStarting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-zinc-950">
          <AlertCircle className="w-8 h-8 text-zinc-500" />
          <p className="text-zinc-400">
            {isError ? (status as any).Error : 'CPA is not running'}
          </p>
          <Button
            variant="outline"
            onClick={() => startCpa()}
            className="gap-2"
          >
            <RefreshCw size={14} />
            Start CPA
          </Button>
        </div>
      )}
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(frontend): dashboard with CPA child webview and status overlays"
```

---

## Task 10: Frontend — Logs Page

**Files:**
- Create: `src/pages/Logs.tsx`
- Create: `src/components/LogList.tsx`

**Step 1: Create `src/components/LogList.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import type { LogLine } from '@/lib/tauri'
import { cn } from '@/lib/utils'

interface Props {
  lines: LogLine[]
  autoScroll: boolean
}

export function LogList({ lines, autoScroll }: Props) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoScroll) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, autoScroll])

  return (
    <div className="flex-1 overflow-y-auto font-mono text-xs leading-5 p-2">
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            'flex gap-2 hover:bg-zinc-800/50 px-1 rounded',
            line.level === 'stderr' ? 'text-red-400' : 'text-zinc-300'
          )}
        >
          <span className="text-zinc-600 shrink-0 select-none">
            {line.ts.substring(11, 23)}
          </span>
          <span className="break-all">{line.text}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}
```

**Step 2: Create `src/pages/Logs.tsx`**

```tsx
import { useState } from 'react'
import { LogList } from '@/components/LogList'
import { useLogStore } from '@/stores/logs'
import { clearLogs } from '@/lib/tauri'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'

export function Logs() {
  const { lines, clear } = useLogStore()
  const [search, setSearch] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)

  const filtered = search
    ? lines.filter((l) => l.text.toLowerCase().includes(search.toLowerCase()))
    : lines

  const handleClear = () => {
    clearLogs()
    clear()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <Input
          placeholder="Filter logs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 text-xs bg-zinc-900 border-zinc-700 max-w-xs"
        />
        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer ml-2">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="accent-zinc-400"
          />
          Auto-scroll
        </label>
        <span className="ml-auto text-xs text-zinc-600">{lines.length} lines</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClear}>
          <Trash2 size={14} />
        </Button>
      </div>

      <LogList lines={filtered} autoScroll={autoScroll} />
    </div>
  )
}
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(frontend): logs page with search, auto-scroll, clear"
```

---

## Task 11: Frontend — Settings Page

**Files:**
- Create: `src/pages/Settings.tsx`

```tsx
import { useEffect, useState } from 'react'
import { getSettings, saveSettings, readConfigYaml, writeConfigYaml, openDataDir } from '@/lib/tauri'
import type { AppSettings } from '@/lib/tauri'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { FolderOpen, Save } from 'lucide-react'

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [yaml, setYaml] = useState('')
  const [saving, setSaving] = useState(false)
  const [yamlError, setYamlError] = useState('')
  const [savedMsg, setSavedMsg] = useState('')

  useEffect(() => {
    getSettings().then(setSettings)
    readConfigYaml().then(setYaml).catch(() => {})
  }, [])

  const handleSaveSettings = async () => {
    if (!settings) return
    setSaving(true)
    await saveSettings(settings)
    setSavedMsg('Saved!')
    setTimeout(() => setSavedMsg(''), 2000)
    setSaving(false)
  }

  const handleSaveYaml = async () => {
    setYamlError('')
    setSaving(true)
    try {
      await writeConfigYaml(yaml)
      setSavedMsg('config.yaml saved!')
      setTimeout(() => setSavedMsg(''), 2000)
    } catch (e) {
      setYamlError(String(e))
    }
    setSaving(false)
  }

  if (!settings) return <div className="p-6 text-zinc-400">Loading...</div>

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-zinc-200 mb-4">App Settings</h2>
        <div className="space-y-4 max-w-sm">
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">CPA Port</Label>
            <Input
              type="number"
              value={settings.port}
              onChange={(e) => setSettings({ ...settings, port: Number(e.target.value) })}
              className="h-8 text-sm bg-zinc-900 border-zinc-700"
            />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoStart}
              onChange={(e) => setSettings({ ...settings, autoStart: e.target.checked })}
              className="accent-zinc-400"
            />
            <span className="text-zinc-300">Auto-start CPA on app launch</span>
          </label>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSaveSettings} disabled={saving} className="gap-1.5">
              <Save size={13} /> Save Settings
            </Button>
            <Button size="sm" variant="outline" onClick={openDataDir} className="gap-1.5">
              <FolderOpen size={13} /> Open Data Dir
            </Button>
            {savedMsg && <span className="text-xs text-green-400 self-center">{savedMsg}</span>}
          </div>
        </div>
      </div>

      <Separator className="bg-zinc-800" />

      <div className="flex-1">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-200">config.yaml</h2>
          <Button size="sm" onClick={handleSaveYaml} disabled={saving} className="gap-1.5">
            <Save size={13} /> Save
          </Button>
        </div>
        {yamlError && <p className="text-xs text-red-400 mb-2">{yamlError}</p>}
        <textarea
          value={yaml}
          onChange={(e) => setYaml(e.target.value)}
          spellCheck={false}
          className="w-full h-96 font-mono text-xs bg-zinc-900 border border-zinc-700 rounded p-3 text-zinc-300 resize-y outline-none focus:border-zinc-500"
        />
      </div>
    </div>
  )
}
```

**Commit:**

```bash
git add -A
git commit -m "feat(frontend): settings page - port, auto-start, config.yaml editor"
```

---

## Task 12: Frontend — About & Update Page

**Files:**
- Create: `src/pages/About.tsx`

```tsx
import { useEffect, useState } from 'react'
import { checkCpaUpdate, downloadCpaUpdate } from '@/lib/tauri'
import { useCpaStore } from '@/stores/cpa'
import { stopCpa, startCpa } from '@/lib/tauri'
import { listen } from '@tauri-apps/api/event'
import type { UpdateCheckResult } from '@/lib/tauri'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, Download, CheckCircle } from 'lucide-react'
import { getVersion } from '@tauri-apps/api/app'

export function AboutPage() {
  const { status } = useCpaStore()
  const [appVersion, setAppVersion] = useState('')
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getVersion().then(setAppVersion)

    const unsub1 = listen<[number, number]>('cpa:download-progress', (e) => {
      setProgress(e.payload)
    })
    const unsub2 = listen('cpa:download-complete', () => {
      setDone(true)
      setDownloading(false)
      setProgress(null)
    })
    return () => {
      unsub1.then((fn) => fn())
      unsub2.then((fn) => fn())
    }
  }, [])

  const handleCheck = async () => {
    setChecking(true)
    setError('')
    try {
      const result = await checkCpaUpdate()
      setUpdate(result)
    } catch (e) {
      setError(String(e))
    }
    setChecking(false)
  }

  const handleUpdate = async () => {
    if (!update) return
    setDownloading(true)
    setDone(false)
    setError('')
    try {
      // Stop CPA first if running
      if (status === 'Running') await stopCpa()
      await downloadCpaUpdate(update.downloadUrl, update.latestVersion)
      // Restart
      await startCpa()
    } catch (e) {
      setError(String(e))
      setDownloading(false)
    }
  }

  const pct = progress ? Math.round((progress[0] / progress[1]) * 100) : 0

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-md space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">CPA Desktop</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Desktop manager for CLIProxyAPI
          </p>
          <Badge variant="outline" className="mt-2 text-xs">v{appVersion}</Badge>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300">CLIProxyAPI Binary</h2>

          <div className="flex items-center gap-3">
            <div className="text-sm text-zinc-400">
              Current: <span className="text-zinc-200">{update?.currentVersion ?? '—'}</span>
            </div>
            {update && (
              <div className="text-sm text-zinc-400">
                Latest: <span className="text-zinc-200">{update.latestVersion}</span>
              </div>
            )}
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={handleCheck}
              disabled={checking}
              className="gap-1.5"
            >
              <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
              Check for Updates
            </Button>

            {update?.updateAvailable && !done && (
              <Button
                size="sm"
                onClick={handleUpdate}
                disabled={downloading}
                className="gap-1.5"
              >
                <Download size={13} />
                {downloading ? `Downloading... ${pct}%` : `Update to ${update.latestVersion}`}
              </Button>
            )}
          </div>

          {downloading && progress && (
            <div className="w-full bg-zinc-800 rounded-full h-1.5">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          {done && (
            <div className="flex items-center gap-1.5 text-sm text-green-400">
              <CheckCircle size={14} />
              Updated and restarted successfully!
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          {update && !update.updateAvailable && (
            <p className="text-sm text-zinc-500">Already up to date.</p>
          )}
        </div>

        <div className="text-xs text-zinc-600 space-y-1">
          <p>
            <a
              href="https://github.com/router-for-me/CLIProxyAPI"
              className="text-zinc-500 hover:text-zinc-300"
              target="_blank"
            >
              CLIProxyAPI on GitHub
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
```

**Commit:**

```bash
git add -A
git commit -m "feat(frontend): about page with CPA update download and progress"
```

---

## Task 13: First Run Experience (Binary Not Present)

**Files:**
- Create: `src/components/FirstRunSetup.tsx`
- Modify: `src/App.tsx`

**Goal:** When CPA binary is absent, show a setup screen instead of the main app.

**Step 1: Add `cpa_binary_exists` command to Rust**

In `commands/cpa.rs`:

```rust
#[tauri::command]
pub fn cpa_binary_exists(app: AppHandle) -> bool {
    app_config::cpa_binary_path(&app).exists()
}
```

Register in `lib.rs`.

**Step 2: Create `src/components/FirstRunSetup.tsx`**

```tsx
import { useState, useEffect } from 'react'
import { checkCpaUpdate, downloadCpaUpdate } from '@/lib/tauri'
import { listen } from '@tauri-apps/api/event'
import type { UpdateCheckResult } from '@/lib/tauri'
import { Button } from '@/components/ui/button'
import { Download, Loader2 } from 'lucide-react'

interface Props {
  onComplete: () => void
}

export function FirstRunSetup({ onComplete }: Props) {
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null)
  const [checking, setChecking] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    checkCpaUpdate()
      .then(setUpdate)
      .catch((e) => setError(String(e)))
      .finally(() => setChecking(false))

    const unsubs = [
      listen<[number, number]>('cpa:download-progress', (e) => {
        const [dl, total] = e.payload
        setProgress(Math.round((dl / total) * 100))
      }),
      listen('cpa:download-complete', () => onComplete()),
    ]
    return () => { unsubs.forEach((p) => p.then((fn) => fn())) }
  }, [])

  const handleDownload = async () => {
    if (!update) return
    setDownloading(true)
    try {
      await downloadCpaUpdate(update.downloadUrl, update.latestVersion)
    } catch (e) {
      setError(String(e))
      setDownloading(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-zinc-950 gap-6">
      <h1 className="text-2xl font-semibold text-zinc-100">Welcome to CPA Desktop</h1>
      <p className="text-zinc-400 text-sm max-w-sm text-center">
        CLIProxyAPI binary needs to be downloaded to get started.
      </p>

      {checking && <Loader2 className="animate-spin text-zinc-400" />}

      {update && !downloading && (
        <Button onClick={handleDownload} className="gap-2">
          <Download size={16} />
          Download CPA {update.latestVersion}
        </Button>
      )}

      {downloading && (
        <div className="w-64 space-y-2">
          <div className="bg-zinc-800 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-center text-zinc-400">{progress}%</p>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  )
}
```

**Step 3: Wire into `App.tsx`**

```tsx
import { invoke } from '@tauri-apps/api/core'
// In App():
const [binaryReady, setBinaryReady] = useState<boolean | null>(null)

useEffect(() => {
  invoke<boolean>('cpa_binary_exists').then(setBinaryReady)
}, [])

if (binaryReady === null) return null
if (!binaryReady) return <FirstRunSetup onComplete={() => setBinaryReady(true)} />
// ... rest of app
```

**Commit:**

```bash
git add -A
git commit -m "feat: first run setup - download CPA binary on fresh install"
```

---

## Task 14: GitHub Actions CI/CD

**Files:**
- Create: `.github/workflows/release.yml`

**Goal:** Build and publish installers for Windows (msi + nsis), macOS (dmg), Linux (AppImage + deb) on each git tag.

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: windows-latest
            args: ''
          - platform: macos-latest
            args: '--target aarch64-apple-darwin'
          - platform: macos-latest
            args: '--target x86_64-apple-darwin'
          - platform: ubuntu-22.04
            args: ''

    runs-on: ${{ matrix.platform }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Install Linux deps
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - name: Install frontend deps
        run: npm install

      - name: Build Tauri app
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'CPA Desktop ${{ github.ref_name }}'
          releaseBody: 'See changelog for details.'
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}
```

**Commit:**

```bash
git add -A
git commit -m "ci: GitHub Actions release workflow for Windows/macOS/Linux"
```

---

## Task 15: Polish & Integration Testing

**Checklist:**

1. **Windows test**: Run `npm run tauri dev` on Windows — verify no CMD window appears, CPA starts silently, management panel loads.
2. **First-run test**: Delete `%APPDATA%\cpa-desktop\bin\` — relaunch — verify download screen appears.
3. **Already-running test**: Start CPA manually from CLI, then launch CPA Desktop — verify it attaches without starting a second instance.
4. **Tray test**: Close main window — verify it minimizes to tray. Double-click tray icon — verify window restores.
5. **Update test**: Manually set `cpaVersion` to an old version in `app-settings.json`, click "Check for Updates" — verify update button appears.
6. **Log test**: Start CPA, switch to Logs tab — verify real-time output appears.
7. **Config test**: Edit config.yaml in Settings, save — verify changes persist and CPA restart picks them up.
8. **macOS Reopen**: Close window, click Dock icon — verify window restores (not second instance).

**Final commit:**

```bash
git add -A
git commit -m "chore: final integration and polish"
```

---

## Quick Tauri v2 API Reference

```rust
// Get app data dir
app.path().app_data_dir()

// Manage shared state
app.manage(Arc::new(Mutex::new(MyState::new())));

// Access state in command
#[tauri::command]
fn my_cmd(state: State<'_, MyState>) { ... }

// Emit event to all windows
app.emit("event-name", payload)?;

// Emit to specific window
app.get_webview_window("main")?.emit("event-name", payload)?;
```

```typescript
// Listen for events
import { listen } from '@tauri-apps/api/event'
const unlisten = await listen<Payload>('event-name', (e) => {
  console.log(e.payload)
})
// cleanup:
unlisten()

// Child webview (requires "unstable" feature in Cargo.toml)
import { Webview } from '@tauri-apps/api/webview'
const wv = new Webview(win, 'label', { url, x, y, width, height })
```

## Common Pitfalls

1. **`async` Tauri commands** need `#[tauri::command]` on `async fn` and registered in `invoke_handler!`.
2. **`block_in_place`** is needed when calling async from sync context inside `tokio::task`. Use `tauri::async_runtime::spawn` instead where possible.
3. **`CREATE_NO_WINDOW`** must be `u32`, not `i32`. The value is `0x08000000`.
4. **Webview CSP** must allow `http://localhost:*` for the management panel to load.
5. **`unstable` feature** is required for `new Webview(...)` in the frontend JS API. Add to `Cargo.toml` features.
6. **Tray icon** requires `tray-icon` feature in Tauri and a `tray.png` in icons/.
7. **macOS** codesigning needed for distribution — use `APPLE_CERTIFICATE` secrets in CI.
