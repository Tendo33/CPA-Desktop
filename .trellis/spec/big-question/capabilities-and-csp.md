# Capabilities And CSP

## Problem

A desktop feature works in development but fails in packaged Tauri builds, or a
small feature accidentally grants broad filesystem/network access.

## Root Cause

Tauri v2 capabilities, plugin permissions, and CSP were not updated together or
were broadened without a narrow runtime need.

## Solution

- Add only the exact Tauri permission required.
- Keep filesystem allowlists under app-owned directories when possible.
- Update CSP only for the specific resource scheme/domain needed.
- Run a Tauri build or targeted packaged-app check for permission-sensitive
  changes.

## Prevention Checklist

- [ ] Capability change is minimal and named in the review.
- [ ] CSP change identifies the exact resource it enables.
- [ ] New plugin dependency has matching permission and tests/manual check.
- [ ] No arbitrary user path or shell execution is exposed to frontend code.
