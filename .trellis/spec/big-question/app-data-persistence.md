# App Data Persistence

## Problem

The app fails to start after a crash, settings edit, or interrupted write.

## Root Cause

Settings or config files were overwritten non-atomically, corrupt files were not
quarantined, or app preferences and managed service config disagreed.

## Solution

- Load missing files as defaults.
- Quarantine corrupt settings files before returning defaults.
- Write to a temp sibling, sync, then rename over the target.
- Keep a clear source of truth for values mirrored between app settings and
  service config.

## Prevention Checklist

- [ ] New settings fields have `serde(default)`.
- [ ] Schema migrations are tested.
- [ ] Atomic write behavior avoids remove-before-rename.
- [ ] External install-source files are not overwritten.
- [ ] Config/source-of-truth behavior is documented and tested.
