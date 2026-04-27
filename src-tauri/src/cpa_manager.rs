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
}

impl CpaState {
    pub fn new(port: u16) -> Self {
        Self {
            process: None,
            status: CpaStatus::Idle,
            port,
            auto_start_pending: false,
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

/// Spawn CPA process. Returns piped stdio handles for log capture.
pub fn spawn_cpa(
    binary_path: &PathBuf,
    working_dir: &PathBuf,
    state: &SharedCpaState,
) -> Result<SpawnOutput, String> {
    if !binary_path.exists() {
        return Err("CPA binary not found. Please download it first.".into());
    }

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

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn CPA: {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;

    {
        let mut s = state.lock().unwrap();
        s.process = Some(child);
        s.status = CpaStatus::Starting;
    }

    Ok(SpawnOutput { stdout, stderr })
}

/// Kill CPA process if running.
pub fn kill_cpa(state: &SharedCpaState) {
    let mut s = state.lock().unwrap();
    if let Some(mut child) = s.process.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    s.status = CpaStatus::Stopped;
}

/// Non-blocking check if process is still alive.
pub fn check_process_alive(state: &SharedCpaState) -> bool {
    let mut s = state.lock().unwrap();
    if let Some(child) = s.process.as_mut() {
        match child.try_wait() {
            Ok(None) => true,
            _ => {
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
