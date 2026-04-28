//! Cross-platform child-process helpers.
//!
//! The standard library's `Child::kill` is a hard, immediate `SIGKILL`
//! (or `TerminateProcess` on Windows). For a process like CPA that owns
//! state files and may have its own children, we want to:
//!
//! 1. Ask it nicely first (`SIGTERM` / Ctrl-Break) so it can flush state,
//! 2. Give it a few seconds to exit,
//! 3. Fall back to `SIGKILL` only if it's still alive.
//!
//! On Windows we additionally want any grandchildren CPA spawned to die
//! when CPA dies — that's what Job Objects with
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` give us. We attach the child to a
//! job at spawn time; if our process crashes the OS tears the whole job
//! down for us, which is the only reliable way to avoid orphaned CPA
//! instances on Windows.

use std::process::Child;
use std::time::{Duration, Instant};

/// How long we wait for a graceful exit before escalating to SIGKILL.
const GRACEFUL_TIMEOUT: Duration = Duration::from_secs(3);

/// Polling interval while waiting for graceful exit.
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Send a polite "please exit" signal to `child` without blocking. Returns
/// `Ok(())` if the signal was delivered; the child may still be running.
#[cfg(unix)]
pub fn request_terminate(child: &Child) -> std::io::Result<()> {
    let pid = child.id() as i32;
    // Direct libc::kill avoids pulling in the `nix` crate just for one
    // call. SIGTERM = 15.
    // SAFETY: libc::kill is safe to call with any pid/sig pair; it just
    // returns an errno.
    let rc = unsafe { libc::kill(pid, libc::SIGTERM) };
    if rc == 0 {
        Ok(())
    } else {
        Err(std::io::Error::other(format!(
            "kill(SIGTERM) failed: errno={}",
            std::io::Error::last_os_error()
        )))
    }
}

#[cfg(windows)]
pub fn request_terminate(_child: &Child) -> std::io::Result<()> {
    // Windows has no clean per-process equivalent of SIGTERM for a
    // detached console-less child. `GenerateConsoleCtrlEvent` requires
    // sharing a console, which we explicitly *don't* (CREATE_NO_WINDOW).
    //
    // We therefore short-circuit to the kill path on Windows. The Job
    // Object guarantees the whole process tree dies, which is what we
    // actually care about.
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "graceful terminate not supported on windows console-less children",
    ))
}

/// Try graceful shutdown, falling back to SIGKILL. Always returns once
/// the child is reaped (or the timeout has been exceeded *after* the
/// kill). Best-effort: errors are logged, never returned, since callers
/// generally want to keep going.
pub fn terminate_then_kill(child: &mut Child) {
    // Step 1 — request graceful exit. On Windows this is a no-op.
    let _ = request_terminate(child);

    // Step 2 — poll for natural exit.
    let deadline = Instant::now() + GRACEFUL_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {
                if Instant::now() >= deadline {
                    break;
                }
                std::thread::sleep(POLL_INTERVAL);
            }
            Err(e) => {
                log::warn!("try_wait during graceful stop failed: {e}");
                break;
            }
        }
    }

    // Step 3 — escalate to hard kill.
    if let Err(e) = child.kill() {
        // Already reaped by someone else? `ESRCH` is fine.
        log::debug!("kill on stuck child returned: {e}");
    }
    let _ = child.wait();
}

/// Windows-only: wrap a freshly spawned child in a Job Object so the
/// whole process tree dies if our process exits abnormally. No-op on
/// other platforms.
#[cfg(windows)]
pub fn attach_to_job(child: &Child) -> std::io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_BASIC_LIMIT_INFORMATION,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    // SAFETY: passing nulls is allowed by the API; we check the return.
    let job: HANDLE = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if job.is_null() {
        return Err(std::io::Error::last_os_error());
    }

    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    info.BasicLimitInformation = JOBOBJECT_BASIC_LIMIT_INFORMATION {
        LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        ..unsafe { std::mem::zeroed() }
    };

    let info_ptr = &info as *const _ as *const _;
    let info_size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
    let ok = unsafe {
        SetInformationJobObject(job, JobObjectExtendedLimitInformation, info_ptr, info_size)
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }

    let proc_handle = child.as_raw_handle() as HANDLE;
    let ok = unsafe { AssignProcessToJobObject(job, proc_handle) };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }

    // Important: do NOT close `job`. The kernel keeps the job object
    // alive as long as some handle references it; closing our handle
    // would immediately fire KILL_ON_JOB_CLOSE on the child, which is
    // the opposite of what we want.
    //
    // No explicit `mem::forget` is needed because in windows-sys 0.59
    // `HANDLE` is `*mut c_void` (a Copy type with no Drop impl) — going
    // out of scope here is already a no-op at the C level. The handle
    // is reclaimed by the OS on process exit.
    let _ = job;
    Ok(())
}

#[cfg(not(windows))]
pub fn attach_to_job(_child: &Child) -> std::io::Result<()> {
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn graceful_terminate_reaps_well_behaved_child() {
        let mut child = Command::new("sleep").arg("60").spawn().unwrap();
        let start = Instant::now();
        terminate_then_kill(&mut child);
        // Should be way under the 3-second graceful window; sleep handles SIGTERM.
        assert!(start.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn kill_fallback_reaps_long_sleeper() {
        // A long sleep that we don't expect to honour SIGTERM in any
        // particular way — the important property is that
        // terminate_then_kill always returns with the child reaped.
        let mut child = Command::new("sleep").arg("120").spawn().unwrap();
        terminate_then_kill(&mut child);
        // After return, try_wait must yield Some (i.e. process is gone).
        let exited = matches!(child.try_wait(), Ok(Some(_)));
        assert!(exited, "child should be reaped after terminate_then_kill");
    }
}
