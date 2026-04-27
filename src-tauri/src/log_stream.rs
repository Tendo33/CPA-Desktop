use chrono::Utc;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const RING_SIZE: usize = 2000;

#[derive(Clone, Serialize)]
pub struct LogLine {
    pub ts: String,
    pub level: String,
    pub text: String,
}

pub type LogBuffer = Arc<Mutex<Vec<LogLine>>>;

pub fn new_log_buffer() -> LogBuffer {
    Arc::new(Mutex::new(Vec::with_capacity(RING_SIZE)))
}

pub fn append(buf: &LogBuffer, level: &str, text: String) {
    let line = LogLine {
        ts: Utc::now().to_rfc3339(),
        level: level.to_string(),
        text,
    };
    let mut b = buf.lock().unwrap();
    if b.len() >= RING_SIZE {
        b.remove(0);
    }
    b.push(line);
}

pub fn get_all(buf: &LogBuffer) -> Vec<LogLine> {
    buf.lock().unwrap().clone()
}

/// Spawn threads to read stdout and stderr from a process and emit events.
/// When a stderr line matches an "address already in use" pattern, emits a
/// structured `CpaStatus::Error("port_in_use:{port}")` so the UI can offer
/// an automatic port +1 retry.
pub fn pipe_process_output(
    app: AppHandle,
    buf: LogBuffer,
    stdout: std::process::ChildStdout,
    stderr: std::process::ChildStderr,
    port: u16,
    cpa_state: crate::cpa_manager::SharedCpaState,
) {
    let app1 = app.clone();
    let buf1 = buf.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            append(&buf1, "stdout", line.clone());
            let _ = app1.emit(
                "cpa:log",
                LogLine {
                    ts: Utc::now().to_rfc3339(),
                    level: "stdout".into(),
                    text: line,
                },
            );
        }
    });

    let buf2 = buf;
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            append(&buf2, "stderr", line.clone());
            let lower = line.to_lowercase();
            if lower.contains("address already in use") || lower.contains("bind: only one usage") {
                let msg = format!("port_in_use:{port}");
                if let Ok(mut s) = cpa_state.lock() {
                    s.status = crate::cpa_manager::CpaStatus::Error(msg.clone());
                }
                let _ = app.emit("cpa:status", &crate::cpa_manager::CpaStatus::Error(msg));
            }
            let _ = app.emit(
                "cpa:log",
                LogLine {
                    ts: Utc::now().to_rfc3339(),
                    level: "stderr".into(),
                    text: line,
                },
            );
        }
    });
}
