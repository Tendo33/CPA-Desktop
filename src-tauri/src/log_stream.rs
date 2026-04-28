use chrono::Utc;
use serde::Serialize;
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
        for raw in BufReader::new(stdout).lines().map_while(Result::ok) {
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
            let line = redact(&raw);
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
}
