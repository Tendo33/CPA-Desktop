# CPA Desktop

A cross-platform desktop app for [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) built with **Tauri v2 + Rust + React**.

![CPA Desktop poster](assets/readme/poster.png)

## Download

Grab the latest installer for your OS from the
[**Releases page**](https://github.com/Tendo33/CPA-Desktop/releases/latest).
Once installed, the app updates itself in place — see
[How it works](#how-it-works).

| Platform            | Recommended installer                       |
| ------------------- | ------------------------------------------- |
| Windows x64 / ARM64 | `*-setup.exe` (NSIS, supports auto-update)  |
| macOS Apple Silicon | `*_aarch64.dmg`                             |
| macOS Intel         | `*_x64.dmg`                                 |
| Linux x64 / ARM64   | `*.AppImage` or `*.deb`                     |

> Windows MSI bundles are also published if you need them for managed
> deployments, but the NSIS `.exe` is the default download.

## What it does

- **In-app self-update** — CPA Desktop ships its own auto-updater (Tauri updater plugin) and pulls new releases from GitHub
- **Auto-downloads & updates the CPA binary** from GitHub releases — no manual unzipping
- **Multiple install sources** — works alongside Homebrew, AUR/system packages, or fully custom paths (see below)
- **Silent background launch** — no black CMD window on Windows
- **Detects existing CPA** — if CPA is already running, it just connects to it
- **Real-time log viewer** — stdout/stderr streaming from the CPA process
- **Config editor** — edit `config.yaml` from within the app
- **System tray** — close to tray, double-click to restore
- **One-click CPA updates** — downloads the new binary and restarts CPA automatically

## Install sources

CPA Desktop can manage CPA itself or hand off to whichever package
manager already installed it. Switch sources from **Settings → Install
Source**; auto-detection populates the available choices.

| Source       | Binary                        | Config                                    | Update via                                  |
| ------------ | ----------------------------- | ----------------------------------------- | ------------------------------------------- |
| `Managed`    | `<appData>/bin/cli-proxy-api` | `<appData>/data/config.yaml`              | GitHub releases (handled in app)            |
| `Homebrew`   | `$(brew --prefix)/bin/...`    | `$(brew --prefix)/etc/cliproxyapi.conf`   | `brew upgrade cliproxyapi` (handled in app) |
| `SystemPath` | first match on `$PATH`        | `~/.cli-proxy-api/config.yaml` by default | your package manager (instructions only)    |
| `Custom`     | user-provided                 | user-provided                             | manual (instructions only)                  |

Notes:

- Homebrew users running `brew services start cliproxyapi` should
  `brew services stop` first — CPA Desktop spawns CPA itself and will
  conflict on the listening port otherwise.
- AUR / one-shot installer users should run
  `systemctl --user disable cli-proxy-api` for the same reason.
- For external sources we never overwrite files we don't own; the
  "Update" action shows the right command to run in your terminal.

## Product preview

These generated previews show CPA Desktop's shell and core workflows. The
dashboard panel is illustrative; the live CPA management webview is loaded from
CPA at runtime.

### Dashboard preview

![Dashboard preview](assets/readme/dashboard.png)

### Logs preview

![Logs preview](assets/readme/logs.png)

### Settings preview

![Settings preview](assets/readme/settings.png)

Run `node scripts/generate-assets.mjs` to refresh preview images at their exact
dimensions.

## Code signing status

| Platform | Status                  | What you'll see on first launch                              |
| -------- | ----------------------- | ------------------------------------------------------------ |
| macOS    | Unsigned (TODO: notarize) | Gatekeeper warning. See the macOS notes below.               |
| Windows  | Unsigned (TODO: code-sign) | SmartScreen prompt → _More info_ → _Run anyway_              |
| Linux    | N/A                     | No equivalent to Gatekeeper; AppImage / `.deb` work as-is.   |

### macOS: clear the quarantine flag

Because the build is unsigned, macOS marks the downloaded `.dmg` (and the
`.app` it installs) as quarantined. Either of these one-line fixes works:

```bash
# Option A — clear quarantine on the .dmg before opening it
xattr -d com.apple.quarantine ~/Downloads/CPA.Desktop_*_aarch64.dmg
# (use ..._x64.dmg on Intel Macs)

# Option B — already installed? clear it on the app bundle
xattr -cr "/Applications/CPA Desktop.app"
```

After that, double-click the `.dmg` (or launch the app) as usual.

Maintainers: see `docs/SIGNING.md` for the planned signing pipeline and the
GitHub secrets required to enable it.

## Platforms

| Platform            | Installer            |
| ------------------- | -------------------- |
| Windows x64         | `.exe` / `.msi`      |
| Windows ARM64       | `.exe` / `.msi`      |
| macOS Apple Silicon | `.dmg`               |
| macOS Intel         | `.dmg`               |
| Linux x64           | `.AppImage` / `.deb` |
| Linux ARM64         | `.AppImage` / `.deb` |

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

1. On first launch (Managed source), CPA Desktop downloads the CPA binary from GitHub releases into your app data folder
2. It starts CPA as a hidden subprocess (no console window on Windows) using the resolved install-source paths
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
