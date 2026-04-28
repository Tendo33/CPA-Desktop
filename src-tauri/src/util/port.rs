//! Local-port helpers for pre-flight checks.
//!
//! We use these to surface "port already in use" errors *before* spawning
//! CPA. CPA's own stderr eventually says the same thing, but doing the
//! check up front lets us return a structured error and avoid an extra
//! 30-second startup-timeout wait when the user just has the wrong port.

use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener};

/// Returns `true` if the port appears to be free on loopback.
///
/// We require the v4 loopback binding to succeed (CPA binds v4 / 0.0.0.0
/// in practice). v6 is checked best-effort: if v6 loopback is disabled
/// outright the v6 bind will fail with an unrelated error, which we
/// treat as "not v6's fault".
pub fn is_port_available(port: u16) -> bool {
    let v4 = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let v4_ok = TcpListener::bind(v4)
        .map(|l| {
            let _ = l.set_nonblocking(true);
            true
        })
        .unwrap_or(false);
    if !v4_ok {
        return false;
    }
    // v6 is informational — only treat as conflict if the kernel says
    // "address in use" specifically. Other errors (no v6 stack, etc.)
    // shouldn't poison the result.
    let v6 = SocketAddr::from((Ipv6Addr::LOCALHOST, port));
    match TcpListener::bind(v6) {
        Ok(l) => {
            let _ = l.set_nonblocking(true);
            true
        }
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => false,
        Err(_) => true,
    }
}

/// Try to identify what's holding the port. Best-effort — used only for
/// surfacing a friendlier error message; failures fall back to "unknown".
pub fn describe_port_holder(_port: u16) -> Option<String> {
    // Cross-platform port-holder lookup is non-trivial (would need lsof /
    // netstat parsing or a procfs crawl). Skipping the heavy implementation
    // for now; the helper exists so the call sites are stable and we can
    // wire in `lsof`/`Get-NetTCPConnection` later without UI churn.
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ephemeral_port_is_available_after_drop() {
        // Bind ephemeral, capture port, drop listener, then verify the
        // helper agrees the port is free again.
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0u16)).unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        // SO_LINGER + TIME_WAIT can race here, but ephemeral ports get
        // reused fast on every modern OS, so this is reliable in practice.
        assert!(is_port_available(port));
    }

    #[test]
    fn held_port_reports_unavailable() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0u16)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(!is_port_available(port));
        drop(listener);
    }
}
