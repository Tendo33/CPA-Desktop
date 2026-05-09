# App Data And Configuration

Use this for settings, config files, managed binary paths, and install-source
changes.

## App Data Layout

```text
app-data/
  bin/cli-proxy-api[.exe]   # managed binary
  data/
    config.yaml             # managed CPA config
    logs/                   # app logs
    backups/                # config backups
  app-settings.json         # desktop preferences
```

Use Tauri's app-data APIs for OS-specific locations. Do not hard-code user home
paths unless a specific install source requires them.

## Settings Rules

- Include a `schemaVersion` or equivalent migration marker.
- Use `serde(default)` for fields added after v1.
- Migrate old settings forward on load.
- Quarantine corrupt settings files as `settings.broken.<timestamp>.json` and
  return defaults.
- Write settings atomically: write temp file, sync, rename over destination.

## Config Rules

- Treat `config.yaml` as authoritative for runtime values owned by the managed
  service, such as the CPA port.
- Keep app preferences in `app-settings.json`.
- When settings and config disagree, define a deterministic sync direction and
  cover it with tests.
- Never overwrite external package-manager config files unless the user has
  explicitly chosen a managed source.

## Install Source Rules

| Source | Ownership | Update Behavior |
| --- | --- | --- |
| Managed | App owns binary and managed config | Download GitHub release asset |
| Homebrew | Package manager owns binary/config | Run or show `brew upgrade` |
| SystemPath | External owner | Show instructions only |
| Custom | User-owned paths | Show instructions only |

Keep path resolution testable by passing small context structs instead of
requiring `AppHandle` everywhere.

## Tests Required

- Missing settings file returns defaults.
- Corrupt settings file is quarantined.
- Legacy settings migrate to the current schema.
- Path resolution matches each install source.
- Atomic writes never remove the destination before the replacement is ready.
