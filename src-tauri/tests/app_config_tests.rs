use cpa_desktop_lib::app_config::{load_settings_at, SETTINGS_SCHEMA_VERSION};

#[test]
fn quarantines_corrupt_settings_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    std::fs::write(&path, "not-json{").unwrap();

    let s = load_settings_at(&path);
    assert_eq!(s.schema_version, SETTINGS_SCHEMA_VERSION);

    let entries: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        entries.iter().any(|n| n.starts_with("settings.broken.")),
        "expected quarantined backup file, got: {entries:?}"
    );
}

#[test]
fn returns_defaults_when_file_missing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("does-not-exist.json");
    let s = load_settings_at(&path);
    assert_eq!(s.schema_version, SETTINGS_SCHEMA_VERSION);
    assert_eq!(s.port, 8317);
}

#[test]
fn loads_valid_settings_with_schema_version() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    std::fs::write(
        &path,
        r#"{"schemaVersion":1,"port":9999,"autoStart":false,"cpaVersion":null}"#,
    )
    .unwrap();
    let s = load_settings_at(&path);
    assert_eq!(s.port, 9999);
    assert!(!s.auto_start);
}

#[test]
fn loads_legacy_settings_without_schema_version() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    std::fs::write(&path, r#"{"port":8317,"autoStart":true,"cpaVersion":null}"#).unwrap();
    let s = load_settings_at(&path);
    assert_eq!(s.schema_version, SETTINGS_SCHEMA_VERSION);
    assert_eq!(s.port, 8317);
}
