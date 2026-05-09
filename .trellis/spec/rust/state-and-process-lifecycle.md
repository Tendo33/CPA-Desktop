# State And Process Lifecycle

Use this for native subprocess, health monitor, tray, and auto-restart work.

## Core Invariants

- `spawn_cpa` is the single chokepoint for starting the child process.
- Every successful spawn increments a monotonic `epoch`.
- Generation-specific shutdown uses `kill_cpa_at_epoch(state, Some(epoch))`.
- Readiness watchers and health monitors exit silently when the epoch changes.
- The UI receives state through Tauri events such as `cpa:status`, not by
  polling process internals.

## Locking Rules

- Keep `Arc<Mutex<_>>` guards short.
- Do not hold a guard across `.await`, `Command::spawn`, file IO, HTTP calls, or
  event emission.
- Claim a process slot under lock before side effects, then release the lock.
- On spawn errors, clear the `starting` flag before returning.

## Process Rules

- Pipe stdout and stderr so logs can be streamed.
- On Windows, suppress the console window for managed child processes.
- Attach child processes to a job/process group when the platform helper exists.
- Terminate gracefully first, then force-kill after a short window.
- Detect port conflicts early with a preflight probe when possible.

## Health Monitor Rules

- Probe loopback strictly; a generic HTTP response on the port is not enough.
- Re-read runtime settings when cheap so health paths and restart flags update
  without requiring app restart.
- Use bounded restart attempts and backoff.
- Emit user-visible restart events only with redacted, safe reasons.

## Wrong Vs Correct

### Wrong

```rust
let mut state = shared.lock().unwrap();
tokio::time::sleep(Duration::from_secs(1)).await;
state.status = CpaStatus::Running;
```

### Correct

```rust
tokio::time::sleep(Duration::from_secs(1)).await;
let mut state = shared.lock().unwrap();
if state.epoch == expected_epoch {
    state.status = CpaStatus::Running;
}
```
