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

    let _output = spawn_cpa(&path, &workdir, &state).expect("spawn");
    {
        let s = state.lock().unwrap();
        assert!(matches!(s.status, CpaStatus::Starting | CpaStatus::Running));
    }

    std::thread::sleep(Duration::from_millis(150));
    assert!(check_process_alive(&state), "mock should still be alive");

    kill_cpa(&state);
    std::thread::sleep(Duration::from_millis(150));
    assert!(
        !check_process_alive(&state),
        "mock should be dead after kill"
    );
}
