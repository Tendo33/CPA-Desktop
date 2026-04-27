# CPA Desktop

A cross-platform desktop app for [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) built with **Tauri v2 + Rust + React**.

## What it does

- **Auto-downloads & updates** the CPA binary from GitHub releases — no manual unzipping
- **Silent background launch** — no black CMD window on Windows
- **Detects existing CPA** — if CPA is already running, it just connects to it
- **Real-time log viewer** — stdout/stderr streaming from the CPA process
- **Config editor** — edit `config.yaml` from within the app
- **System tray** — close to tray, double-click to restore
- **One-click CPA updates** — downloads the new binary and restarts CPA automatically

## Screenshots

| Dashboard                                    | Logs                               | Settings                                   |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------ |
| ![Dashboard](docs/screenshots/dashboard.png) | ![Logs](docs/screenshots/logs.png) | ![Settings](docs/screenshots/settings.png) |

> Dashboard shows CPA's built-in management panel (`/management.html#/quota`).
> Run `npm run tauri dev` and capture each tab at 1280×800 to refresh the images.

## Unsigned builds

Until v0.2.0 the binaries are unsigned. The first launch will be blocked by Gatekeeper / SmartScreen.

**macOS** — clear the quarantine attribute once after copying to Applications:

```sh
xattr -cr "/Applications/CPA Desktop.app"
```

**Windows** — on the SmartScreen prompt, click _More info_ → _Run anyway_.

## Platforms

| Platform            | Installer            |
| ------------------- | -------------------- |
| Windows x64         | `.msi` / `.exe`      |
| Windows ARM64       | `.msi` / `.exe`      |
| macOS Apple Silicon | `.dmg`               |
| macOS Intel         | `.dmg`               |
| Linux x64           | `.AppImage` / `.deb` |

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) stable
- Tauri system dependencies — see [Tauri prerequisites](https://tauri.app/start/prerequisites/)

### Getting started

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

Produces platform-native installers in `src-tauri/target/release/bundle/`.

## How it works

1. On first launch, CPA Desktop downloads the CPA binary from GitHub releases into your app data folder
2. It starts CPA as a hidden subprocess (no console window on Windows)
3. The management panel (`/management.html#/quota`) loads in a native webview
4. CPA's static panel files are auto-managed by CPA itself
5. On close, the app minimizes to the system tray

### Data directory

```
Windows:  %APPDATA%\cpa-desktop\
macOS:    ~/Library/Application Support/cpa-desktop/
Linux:    ~/.local/share/cpa-desktop/

├── bin/cli-proxy-api[.exe]   # managed CPA binary
├── data/
│   ├── config.yaml           # your CPA configuration
│   └── static/               # auto-managed by CPA
└── app-settings.json         # app preferences
```

## License

MIT
