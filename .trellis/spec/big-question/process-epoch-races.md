# Process Epoch Races

## Problem

The UI shows `Stopped` or `Error` even though a newer child process is already
starting or running.

## Root Cause

A stale readiness watcher, kill path, log thread, or health monitor updated
shared state after a newer process generation took over.

## Solution

- Increment an epoch on every successful spawn.
- Pass the expected epoch into readiness watchers, log readers, and kill paths.
- Before writing status, confirm the current epoch still matches.
- Exit background loops when the epoch changes.

## Prevention Checklist

- [ ] `spawn_cpa` remains the only process-start chokepoint.
- [ ] Start slot is claimed before side effects.
- [ ] Stale stop paths call `kill_cpa_at_epoch`.
- [ ] Watchers check epoch before setting status.
- [ ] Tests cover concurrent start rejection and stale generation protection.
