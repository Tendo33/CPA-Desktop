# Code Signing & Auto-update

This document describes the (planned) signing pipeline for CPA Desktop.
The release workflow already detects the relevant secrets and skips
signing when they're absent, so we can ship today and turn signing on
incrementally as certificates become available.

## Required GitHub Action secrets

### macOS notarization

| Secret                       | Source                                                 |
| ---------------------------- | ------------------------------------------------------ |
| `APPLE_CERTIFICATE`          | Base64 of the Developer ID Application `.p12`          |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the `.p12`                                |
| `APPLE_SIGNING_IDENTITY`     | e.g. `Developer ID Application: Acme Inc (TEAMID12345)`|
| `APPLE_ID`                   | Apple ID email used for notarytool                     |
| `APPLE_PASSWORD`             | App-specific password for that Apple ID                |
| `APPLE_TEAM_ID`              | 10-char team identifier                                |

When all six are present, the `Build Tauri app (signed macOS)` job runs
and the resulting `.dmg` is both signed and notarized.

### Windows code signing

The current workflow does **not** yet wire Windows signing — the cleanest
path forward is Azure Trusted Signing (no HSM required) or a SignPath
account. Once a certificate provider is chosen we'll add:

| Secret                          | Purpose                                  |
| ------------------------------- | ---------------------------------------- |
| `WINDOWS_CERTIFICATE`           | Base64-encoded `.pfx`                    |
| `WINDOWS_CERTIFICATE_PASSWORD`  | Password for the `.pfx`                  |

…and set `windows.certificateThumbprint` in `tauri.conf.json`.

### Tauri auto-updater signature

Tauri verifies updater payloads with a minisign keypair. The current
public key is committed to `tauri.conf.json` under `plugins.updater.pubkey`.
The matching private key must be available in CI as:

| Secret                                | Purpose                          |
| ------------------------------------- | -------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`           | Private key (raw or path)        |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`  | Password for the private key     |

To rotate the keypair:

```bash
npx @tauri-apps/cli signer generate -w ~/.tauri/cpa-desktop.key
```

Then update `pubkey` in `src-tauri/tauri.conf.json` and refresh the GH
secrets. Old clients will refuse the new release until they're upgraded
through some other channel — rotate carefully.

## Local verification

```bash
# macOS — confirm a built .app is correctly signed and notarized
codesign --verify --deep --strict --verbose=2 "CPA Desktop.app"
spctl --assess --type execute --verbose "CPA Desktop.app"

# Windows — verify .exe signature
signtool verify /pa /v "CPA Desktop_x.y.z_x64-setup.exe"
```
