use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", content = "data")]
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
    pub auto_start_pending: bool,
    /// True between the moment `spawn_cpa` claims the slot and the
    /// moment the readiness watcher either flips status to Running or
    /// reports failure. Prevents two concurrent spawn attempts (e.g.
    /// auto-restart races a user clicking Start).
    pub starting: bool,
    /// Monotonic counter incremented on every successful `spawn_cpa`.
    /// `kill_cpa` records the epoch it took the child from so that a
    /// late-arriving "I terminated you" doesn't overwrite the status of
    /// a *newer* spawn.
    pub epoch: u64,
}

impl CpaState {
    pub fn new(port: u16) -> Self {
        Self {
            process: None,
            status: CpaStatus::Idle,
            port,
            auto_start_pending: false,
            starting: false,
            epoch: 0,
        }
    }
}

pub type SharedCpaState = Arc<Mutex<CpaState>>;

pub fn new_shared_state(port: u16) -> SharedCpaState {
    Arc::new(Mutex::new(CpaState::new(port)))
}

pub struct SpawnOutput {
    pub stdout: std::process::ChildStdout,
    pub stderr: std::process::ChildStderr,
}

/// Spawn CPA process. Returns piped stdio handles for log capture and
/// the epoch number assigned to this spawn — caller passes it back to
/// `kill_cpa` so a stale stop doesn't clobber a fresh spawn.
///
/// Refuses to start if another spawn is already in flight or a process
/// is still alive in `state`. This is the single chokepoint that
/// prevents races between auto-restart and the user clicking Start.
pub fn spawn_cpa(
    binary_path: &PathBuf,
    working_dir: &PathBuf,
    state: &SharedCpaState,
) -> Result<(SpawnOutput, u64), String> {
    if !binary_path.exists() {
        return Err("CPA binary not found. Please download it first.".into());
    }

    // Claim the slot atomically before any side effects.
    {
        let mut s = state.lock().unwrap();
        if s.starting {
            return Err("CPA is already starting".into());
        }
        if s.process.is_some() {
            return Err("CPA is already running".into());
        }
        s.starting = true;
    }
    // Anything below here that returns Err must release the slot.
    let release_on_err = |state: &SharedCpaState| {
        let mut s = state.lock().unwrap();
        s.starting = false;
    };

    let mut cmd = Command::new(binary_path);
    cmd.current_dir(working_dir);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            release_on_err(state);
            return Err(format!("Failed to spawn CPA: {e}"));
        }
    };

    if let Err(e) = crate::util::proc::attach_to_job(&child) {
        log::warn!("attach_to_job failed: {e} (continuing; orphan risk on hard crash)");
    }

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = child.kill();
            release_on_err(state);
            return Err("no stdout".into());
        }
    };
    let stderr = match child.stderr.take() {
        Some(s) => s,
        None => {
            let _ = child.kill();
            release_on_err(state);
            return Err("no stderr".into());
        }
    };

    let epoch = {
        let mut s = state.lock().unwrap();
        s.epoch = s.epoch.wrapping_add(1);
        s.process = Some(child);
        s.status = CpaStatus::Starting;
        s.starting = false; // process slot now owns liveness; readiness watcher may set Running
        s.epoch
    };

    Ok((SpawnOutput { stdout, stderr }, epoch))
}

/// Stop CPA, asking nicely first and falling back to SIGKILL after a
/// short window. Won't overwrite the status of a *newer* spawn that
/// happened concurrently — the caller should pass `expected_epoch`
/// when it cares. `None` means "best-effort, last writer wins" (used
/// by app-shutdown paths).
pub fn kill_cpa_at_epoch(state: &SharedCpaState, expected_epoch: Option<u64>) {
    let (mut child_opt, epoch_at_take) = {
        let mut s = state.lock().unwrap();
        let epoch = s.epoch;
        if let Some(want) = expected_epoch {
            if epoch != want {
                // A newer spawn already replaced this generation; the
                // owner of that spawn is responsible for it.
                return;
            }
        }
        (s.process.take(), epoch)
    };
    if let Some(child) = child_opt.as_mut() {
        crate::util::proc::terminate_then_kill(child);
    }

    // Only declare "Stopped" if no one else has reclaimed the slot in
    // the meantime. Prevents the race where `spawn_cpa` ran between our
    // `take()` and this lock and we'd otherwise stomp Starting → Stopped.
    let mut s = state.lock().unwrap();
    if s.process.is_none() && s.epoch == epoch_at_take && !s.starting {
        s.status = CpaStatus::Stopped;
    }
}

/// Backwards-compatible best-effort kill (used at app shutdown / tray
/// quit). Prefer `kill_cpa_at_epoch(state, Some(epoch))` from anywhere
/// that knows which generation it owns.
pub fn kill_cpa(state: &SharedCpaState) {
    kill_cpa_at_epoch(state, None);
}

/// Non-blocking check if process is still alive.
pub fn check_process_alive(state: &SharedCpaState) -> bool {
    let mut s = state.lock().unwrap();
    if let Some(child) = s.process.as_mut() {
        match child.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) | Err(_) => {
                s.process = None;
                s.status = CpaStatus::Stopped;
                false
            }
        }
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_serializes_with_kind_tag() {
        let s = serde_json::to_string(&CpaStatus::Idle).unwrap();
        assert_eq!(s, "{\"kind\":\"Idle\"}");
    }

    #[test]
    fn running_serializes_with_kind_tag() {
        let s = serde_json::to_string(&CpaStatus::Running).unwrap();
        assert_eq!(s, "{\"kind\":\"Running\"}");
    }

    #[test]
    fn error_serializes_with_data() {
        let s = serde_json::to_string(&CpaStatus::Error("boom".into())).unwrap();
        assert_eq!(s, "{\"kind\":\"Error\",\"data\":\"boom\"}");
    }

    #[test]
    fn roundtrips_via_serde() {
        let original = CpaStatus::Error("bang".into());
        let s = serde_json::to_string(&original).unwrap();
        let parsed: CpaStatus = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed, original);
    }
}
