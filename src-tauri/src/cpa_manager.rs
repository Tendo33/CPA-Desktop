use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CpaStatus {
    Idle,
    Starting,
    Running,
    Stopped,
    #[serde(rename = "error")]
    Error(String),
}

pub struct CpaState {
    pub process: Option<Child>,
    pub status: CpaStatus,
    pub port: u16,
}

impl CpaState {
    pub fn new(port: u16) -> Self {
        Self {
            process: None,
            status: CpaStatus::Idle,
            port,
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
    fn idle_serializes_per_camelcase_rename() {
        let s = serde_json::to_string(&CpaStatus::Idle).unwrap();
        assert_eq!(s, "\"idle\"");
    }

    #[test]
    fn running_serializes_per_camelcase_rename() {
        let s = serde_json::to_string(&CpaStatus::Running).unwrap();
        assert_eq!(s, "\"running\"");
    }

    #[test]
    fn error_serializes_as_object() {
        let s = serde_json::to_string(&CpaStatus::Error("boom".into())).unwrap();
        assert!(s.contains("\"error\""));
        assert!(s.contains("\"boom\""));
    }
}
