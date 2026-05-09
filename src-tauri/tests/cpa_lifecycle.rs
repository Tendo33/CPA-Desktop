#![cfg(unix)]

use std::path::PathBuf;
use std::time::Duration;

use cpa_desktop_lib::cpa_manager::{
    check_process_alive, kill_cpa, new_shared_state, spawn_cpa, CpaStatus,
};

fn fixture() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    p.push("tests/fixtures/mock_cpa.sh");
    p
}

#[test]
fn spawn_and_kill_mock_cpa() {
    let state = new_shared_state(8317);
    let workdir = std::env::temp_dir();
    let path = fixture();

    let (_output, epoch) = spawn_cpa(&path, &workdir, &state).expect("spawn");
    assert_eq!(epoch, 1, "first spawn should be epoch 1");
    {
        let s = state.lock().unwrap();
        assert!(matches!(s.status, CpaStatus::Starting | CpaStatus::Running));
        assert!(!s.starting, "starting flag should be released after spawn");
    }

    // Second concurrent spawn must be rejected — no race window.
    let again = spawn_cpa(&path, &workdir, &state);
    assert!(
        again.is_err(),
        "second spawn should be rejected (got Ok): {:?}",
        again.err()
    );

    std::thread::sleep(Duration::from_millis(150));
    assert!(check_process_alive(&state), "mock should still be alive");

    kill_cpa(&state);
    std::thread::sleep(Duration::from_millis(150));
    assert!(
        !check_process_alive(&state),
        "mock should be dead after kill"
    );
}

#[test]
fn natural_exit_releases_process_slot_for_restart() {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;

    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("exit_immediately.sh");
    {
        let mut f = std::fs::File::create(&path).unwrap();
        writeln!(f, "#!/bin/sh").unwrap();
        writeln!(f, "exit 0").unwrap();
    }
    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&path, perms).unwrap();

    let state = new_shared_state(8317);
    let workdir = tmp.path().to_path_buf();
    let (_output, _epoch) = spawn_cpa(&path, &workdir, &state).expect("spawn");

    let mut exited = false;
    for _ in 0..20 {
        if !check_process_alive(&state) {
            exited = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(exited, "exited child should report not alive");
    {
        let s = state.lock().unwrap();
        assert!(s.process.is_none(), "dead child handle should be cleared");
        assert_eq!(s.status, CpaStatus::Stopped);
    }

    let again = spawn_cpa(&path, &workdir, &state);
    assert!(
        again.is_ok(),
        "restart should be allowed after natural exit: {:?}",
        again.err()
    );
}
