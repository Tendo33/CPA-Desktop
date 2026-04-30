use chrono::Utc;
use serde::Serialize;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const RING_SIZE: usize = 2000;

/// Mask common secret-bearing patterns before they hit the log buffer or
/// the frontend. We can't enumerate every secret CPA might print, so this
/// is a defensive sweep: anything that *looks* like an API key, a bearer
/// token, or an `OPENAI_API_KEY=...`-style env assignment gets the value
/// truncated to its first few characters.
pub fn redact(line: &str) -> String {
    use std::sync::OnceLock;
    static RES: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    let res = RES.get_or_init(|| {
        // (key fragment, value capture group). Order matters — the more
        // specific match wins.
        vec![
            regex::Regex::new(r#"(?i)(api[_-]?key|access[_-]?token|secret|password|bearer)\s*[:=]\s*["']?([A-Za-z0-9._\-+/=]{6,})["']?"#).unwrap(),
            regex::Regex::new(r#"(?i)(authorization)\s*[:=]\s*["']?(bearer\s+)?([A-Za-z0-9._\-+/=]{6,})["']?"#).unwrap(),
            regex::Regex::new(r#"\b(sk-[A-Za-z0-9]{8,})\b"#).unwrap(),
        ]
    });
    let mut out = line.to_string();
    for re in res {
        out = re
            .replace_all(&out, |caps: &regex::Captures| {
                // The actual secret is the last numbered group across our patterns.
                let last = caps.iter().flatten().last().unwrap();
                let s = last.as_str();
                let head = s.chars().take(4).collect::<String>();
                let masked = format!("{head}***[redacted {} chars]", s.len());
                caps[0].replace(s, &masked)
            })
            .into_owned();
    }
    out
}

#[derive(Clone, Serialize)]
pub struct LogLine {
    pub ts: String,
    pub level: String,
    pub text: String,
}

pub type LogBuffer = Arc<Mutex<VecDeque<LogLine>>>;

pub fn new_log_buffer() -> LogBuffer {
    Arc::new(Mutex::new(VecDeque::with_capacity(RING_SIZE)))
}

pub fn append(buf: &LogBuffer, level: &str, text: String) {
    let line = LogLine {
        ts: Utc::now().to_rfc3339(),
        level: level.to_string(),
        text,
    };
    let mut b = buf.lock().unwrap();
    if b.len() >= RING_SIZE {
        b.pop_front();
    }
    b.push_back(line);
}

pub fn get_all(buf: &LogBuffer) -> Vec<LogLine> {
    buf.lock().unwrap().iter().cloned().collect()
}

fn is_current_epoch(state: &crate::cpa_manager::SharedCpaState, expected_epoch: u64) -> bool {
    state
        .lock()
        .map(|s| s.epoch == expected_epoch)
        .unwrap_or(false)
}

fn mark_port_in_use_if_current(
    state: &crate::cpa_manager::SharedCpaState,
    expected_epoch: u64,
    port: u16,
) -> Option<crate::cpa_manager::CpaStatus> {
    let msg = format!("port_in_use:{port}");
    let status = crate::cpa_manager::CpaStatus::Error(msg);
    let mut s = state.lock().ok()?;
    if s.epoch != expected_epoch {
        return None;
    }
    s.status = status.clone();
    Some(status)
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
    spawned_epoch: u64,
    cpa_state: crate::cpa_manager::SharedCpaState,
) {
    let app1 = app.clone();
    let buf1 = buf.clone();
    let state1 = cpa_state.clone();
    std::thread::spawn(move || {
        for raw in BufReader::new(stdout).lines().map_while(Result::ok) {
            if !is_current_epoch(&state1, spawned_epoch) {
                break;
            }
            let line = redact(&raw);
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
        for raw in BufReader::new(stderr).lines().map_while(Result::ok) {
            if !is_current_epoch(&cpa_state, spawned_epoch) {
                break;
            }
            let line = redact(&raw);
            append(&buf2, "stderr", line.clone());
            let lower = line.to_lowercase();
            if lower.contains("address already in use") || lower.contains("bind: only one usage") {
                if let Some(status) = mark_port_in_use_if_current(&cpa_state, spawned_epoch, port) {
                    let _ = app.emit("cpa:status", &status);
                }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_api_key_assignment() {
        let r = redact(r#"loaded api_key="sk-1234567890abcdef""#);
        assert!(!r.contains("sk-1234567890abcdef"));
        assert!(r.contains("[redacted"));
    }

    #[test]
    fn redacts_bearer_header() {
        let r = redact("Authorization: Bearer abcdef1234567890");
        assert!(!r.contains("abcdef1234567890"));
    }

    #[test]
    fn keeps_non_secret_lines_intact() {
        let r = redact("listening on 0.0.0.0:8317");
        assert_eq!(r, "listening on 0.0.0.0:8317");
    }

    #[test]
    fn log_buffer_keeps_latest_lines_in_fifo_order() {
        let buf = new_log_buffer();
        for i in 0..=RING_SIZE {
            append(&buf, "stdout", format!("line {i}"));
        }

        let lines = get_all(&buf);
        assert_eq!(lines.len(), RING_SIZE);
        assert_eq!(lines.first().unwrap().text, "line 1");
        assert_eq!(lines.last().unwrap().text, format!("line {RING_SIZE}"));
        assert_eq!(buf.lock().unwrap().front().unwrap().text, "line 1");
    }

    #[test]
    fn port_in_use_status_is_ignored_for_stale_epoch() {
        let state = crate::cpa_manager::new_shared_state(8317);
        {
            let mut s = state.lock().unwrap();
            s.epoch = 2;
            s.status = crate::cpa_manager::CpaStatus::Running;
        }

        let status = mark_port_in_use_if_current(&state, 1, 8317);

        assert!(status.is_none());
        assert_eq!(
            state.lock().unwrap().status,
            crate::cpa_manager::CpaStatus::Running
        );
    }

    #[test]
    fn port_in_use_status_updates_for_current_epoch() {
        let state = crate::cpa_manager::new_shared_state(8317);
        {
            let mut s = state.lock().unwrap();
            s.epoch = 3;
            s.status = crate::cpa_manager::CpaStatus::Starting;
        }

        let status = mark_port_in_use_if_current(&state, 3, 8317);

        assert_eq!(
            status,
            Some(crate::cpa_manager::CpaStatus::Error(
                "port_in_use:8317".into()
            ))
        );
        assert_eq!(
            state.lock().unwrap().status,
            crate::cpa_manager::CpaStatus::Error("port_in_use:8317".into())
        );
    }
}
