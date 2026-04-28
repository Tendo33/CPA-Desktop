//! Auth-file batch export.
//!
//! Mirrors the Tampermonkey "CPAMC 认证文件批量导出助手" userscript:
//! lists CPA's `/v0/management/auth-files`, downloads each entry with
//! bounded concurrency, packages the raw JSON into a CPA ZIP and/or
//! transforms codex entries into a sub2api ZIP. When both formats are
//! requested they are nested inside a single outer ZIP, matching the
//! userscript output.
//!
//! All HTTP traffic is local-loopback (127.0.0.1:<port>) so we ignore
//! proxy env and skip cert verification — same trust boundary as
//! the rest of the desktop shell.

use std::sync::Arc;
use std::time::Duration;

use base64::Engine as _;
use futures_util::stream::{FuturesUnordered, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::cpa_manager::SharedCpaState;

/// Slim entry returned to the frontend list view. Mirrors the
/// userscript's `prepareListItem`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthFileInfo {
    pub id: String,
    /// Original API name — what CPA's download endpoint expects.
    pub source_name: String,
    /// Basename only, used for display + ZIP entry naming.
    pub file_name: String,
    pub name: String,
    pub r#type: String,
    pub status: String,
    pub account: String,
    pub email: String,
    pub label: String,
    pub size: u64,
    pub modtime: String,
    pub modtime_ms: i64,
    pub plan_type: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArgs {
    pub admin_password: String,
    pub names: Vec<String>,
    pub export_cpa: bool,
    pub export_sub2api: bool,
    /// Bounded fan-out for the per-file download stage. Falls back to
    /// 5 if the caller passes 0/None — same default as the userscript.
    #[serde(default)]
    pub concurrency: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFailure {
    pub source_name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    /// `false` when the user cancelled the Save-As dialog. Frontend
    /// uses this to differentiate "user backed out" from "no files
    /// matched / nothing to write" without crawling counts.
    pub saved: bool,
    pub saved_path: Option<String>,
    pub written_archive: Option<String>,
    pub success_count: usize,
    pub failure_count: usize,
    pub failures: Vec<ExportFailure>,
    pub sub2api_success: usize,
    pub sub2api_failures: Vec<ExportFailure>,
}

fn loopback_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        // CPA listens on 127.0.0.1; honoring HTTP_PROXY would route
        // local traffic through whatever proxy the user has set —
        // exactly the wrong default for a desktop control plane.
        .no_proxy()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

fn bearer(password: &str) -> String {
    let trimmed = password.trim();
    let stripped = trimmed
        .strip_prefix("bearer ")
        .or_else(|| trimmed.strip_prefix("Bearer "))
        .unwrap_or(trimmed)
        .trim();
    stripped.to_string()
}

fn auth_header(password: &str) -> Option<(String, String)> {
    let token = bearer(password);
    if token.is_empty() {
        None
    } else {
        Some(("Authorization".to_string(), format!("Bearer {token}")))
    }
}

fn map_status(status: reqwest::StatusCode, ctx: &str) -> Result<(), String> {
    if status.is_success() {
        Ok(())
    } else if status == reqwest::StatusCode::UNAUTHORIZED
        || status == reqwest::StatusCode::FORBIDDEN
    {
        Err(format!("{ctx}: 401/403, check management secret-key"))
    } else {
        Err(format!("{ctx}: HTTP {}", status.as_u16()))
    }
}

fn list_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/v0/management/auth-files")
}

fn download_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/v0/management/auth-files/download")
}

#[tauri::command]
pub async fn list_auth_files(
    state: State<'_, SharedCpaState>,
    admin_password: String,
) -> Result<Vec<AuthFileInfo>, String> {
    let port = state.lock().unwrap().port;
    let client = loopback_client()?;
    let mut req = client.get(list_url(port));
    if let Some((k, v)) = auth_header(&admin_password) {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    map_status(resp.status(), "list auth files")?;
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let value: Value =
        serde_json::from_str(&text).map_err(|e| format!("invalid JSON from CPA: {e}"))?;
    let files = value
        .get("files")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "missing `files` array in response".to_string())?;

    let mut out = Vec::with_capacity(files.len());
    for (idx, item) in files.iter().enumerate() {
        out.push(prepare_item(item, idx));
    }
    // Newest first, matches the userscript.
    out.sort_by(|a, b| b.modtime_ms.cmp(&a.modtime_ms));
    Ok(out)
}

#[tauri::command]
pub async fn export_auth_files(
    app: AppHandle,
    state: State<'_, SharedCpaState>,
    args: ExportArgs,
) -> Result<ExportResult, String> {
    if !args.export_cpa && !args.export_sub2api {
        return Err("at least one of CPA / sub2api must be selected".into());
    }
    if args.names.is_empty() {
        return Err("no auth files selected".into());
    }
    let port = state.lock().unwrap().port;
    let client = Arc::new(loopback_client()?);
    let header = auth_header(&args.admin_password);
    let concurrency = args
        .concurrency
        .filter(|n| *n > 0)
        .map(|n| n as usize)
        .unwrap_or(5)
        .min(args.names.len().max(1));

    // Bounded fan-out via FuturesUnordered, matching the userscript's
    // `runWithConcurrency` semantics: at most N requests in flight,
    // results collected in completion order.
    let mut downloads: Vec<DownloadOutcome> = Vec::with_capacity(args.names.len());
    let mut iter = args.names.iter().enumerate();
    let mut in_flight: FuturesUnordered<tokio::task::JoinHandle<DownloadOutcome>> =
        FuturesUnordered::new();
    let url = download_url(port);

    for _ in 0..concurrency {
        if let Some((idx, name)) = iter.next() {
            in_flight.push(spawn_download(
                idx,
                name.clone(),
                client.clone(),
                url.clone(),
                header.clone(),
            ));
        }
    }
    while let Some(joined) = in_flight.next().await {
        let outcome = joined.map_err(|e| format!("task join: {e}"))?;
        downloads.push(outcome);
        if let Some((idx, name)) = iter.next() {
            in_flight.push(spawn_download(
                idx,
                name.clone(),
                client.clone(),
                url.clone(),
                header.clone(),
            ));
        }
    }
    downloads.sort_by_key(|d| d.idx);

    let mut successes: Vec<DownloadOk> = Vec::new();
    let mut failures: Vec<ExportFailure> = Vec::new();
    for d in downloads {
        match d.result {
            Ok((file_name, body)) => successes.push(DownloadOk {
                source_name: d.source_name,
                file_name,
                body,
            }),
            Err(reason) => failures.push(ExportFailure {
                source_name: d.source_name,
                reason,
            }),
        }
    }
    if successes.is_empty() {
        return Ok(ExportResult {
            saved: false,
            saved_path: None,
            written_archive: None,
            success_count: 0,
            failure_count: failures.len(),
            failures,
            sub2api_success: 0,
            sub2api_failures: vec![],
        });
    }

    // Stage A: build the CPA ZIP (raw JSON files).
    let stamp = timestamp_suffix();
    let mut archives: Vec<(String, Vec<u8>)> = Vec::new();
    if args.export_cpa {
        let mut used = std::collections::HashSet::new();
        let entries: Vec<(String, Vec<u8>)> = successes
            .iter()
            .enumerate()
            .map(|(i, ok)| {
                let name = unique_json_name(&ok.file_name, i + 1, &mut used);
                (name, ok.body.as_bytes().to_vec())
            })
            .collect();
        let bytes = build_zip(&entries).map_err(|e| format!("CPA zip: {e}"))?;
        archives.push((format!("cpa-jsons-{stamp}.zip"), bytes));
    }

    // Stage B: transform codex entries to sub2api JSON. Per the
    // userscript contract, only `type == codex` entries can be
    // transformed; everything else is recorded as a failure but does
    // NOT abort the export.
    let mut sub2api_failures: Vec<ExportFailure> = Vec::new();
    let mut sub2api_success = 0usize;
    if args.export_sub2api {
        let exported_at = chrono::Utc::now()
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string();
        let mut used = std::collections::HashSet::new();
        let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
        for (i, ok) in successes.iter().enumerate() {
            let sub_name =
                unique_json_name(&build_sub2api_name(&ok.file_name), i + 1, &mut used);
            // We only know the type post-download (the list call gives
            // it but we passed only names downstream). Cheap to detect
            // from the JSON itself; missing fields → not codex.
            let parsed: Value = match serde_json::from_str(&ok.body) {
                Ok(v) => v,
                Err(_) => {
                    sub2api_failures.push(ExportFailure {
                        source_name: ok.source_name.clone(),
                        reason: "invalid JSON".into(),
                    });
                    continue;
                }
            };
            // Heuristic: codex auth files always carry an OpenAI-style
            // access_token (with the OpenAI auth claim), so JWT parsing
            // succeeds. Non-codex types (gemini, claude, etc.) lack
            // these tokens; transform_to_sub2api will surface a
            // domain-specific error and we log it as a skip.
            match transform_to_sub2api(&parsed, &ok.file_name, &exported_at) {
                Ok(json) => {
                    entries.push((sub_name, json.into_bytes()));
                    sub2api_success += 1;
                }
                Err(reason) => sub2api_failures.push(ExportFailure {
                    source_name: ok.source_name.clone(),
                    reason,
                }),
            }
        }
        if !entries.is_empty() {
            let bytes = build_zip(&entries).map_err(|e| format!("sub2api zip: {e}"))?;
            archives.push((format!("sub2api-jsons-{stamp}.zip"), bytes));
        }
    }

    if archives.is_empty() {
        return Ok(ExportResult {
            saved: false,
            saved_path: None,
            written_archive: None,
            success_count: successes.len(),
            failure_count: failures.len(),
            failures,
            sub2api_success,
            sub2api_failures,
        });
    }

    let (default_name, payload) = if archives.len() == 1 {
        let (name, bytes) = archives.into_iter().next().unwrap();
        (name, bytes)
    } else {
        // Outer ZIP holds each inner ZIP verbatim (stored, not
        // re-compressed) — same shape the userscript produced.
        let outer = build_zip(&archives).map_err(|e| format!("outer zip: {e}"))?;
        (format!("auth-jsons-{stamp}.zip"), outer)
    };

    // Save-As dialog. tauri-plugin-dialog's blocking helpers are sync
    // closures, so we hop off the async runtime via tokio's
    // spawn_blocking trick — a oneshot channel into the dialog
    // callback works equally well and avoids the extra task.
    let chosen = save_dialog(&app, &default_name).await;
    let Some(path) = chosen else {
        return Ok(ExportResult {
            saved: false,
            saved_path: None,
            written_archive: Some(default_name.clone()),
            success_count: successes.len(),
            failure_count: failures.len(),
            failures,
            sub2api_success,
            sub2api_failures,
        });
    };

    std::fs::write(&path, &payload).map_err(|e| format!("write file: {e}"))?;

    Ok(ExportResult {
        saved: true,
        saved_path: Some(path.clone()),
        written_archive: Some(default_name),
        success_count: successes.len(),
        failure_count: failures.len(),
        failures,
        sub2api_success,
        sub2api_failures,
    })
}

async fn save_dialog(app: &AppHandle, default_name: &str) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title("Save authentication files")
        .set_file_name(default_name)
        .add_filter("ZIP archive", &["zip"])
        .save_file(move |path| {
            let _ = tx.send(path);
        });
    let path = rx.await.ok().flatten()?;
    // Tauri returns a `FilePath`; on desktop this resolves to a
    // platform path. Fall back to the Display impl for unusual cases
    // (e.g. blob URIs on mobile, which don't apply here but are cheap
    // to be defensive about).
    path.into_path().ok().map(|p| p.to_string_lossy().into_owned())
}

struct DownloadOk {
    source_name: String,
    file_name: String,
    body: String,
}

struct DownloadOutcome {
    idx: usize,
    source_name: String,
    result: Result<(String, String), String>,
}

fn spawn_download(
    idx: usize,
    source_name: String,
    client: Arc<reqwest::Client>,
    url: String,
    header: Option<(String, String)>,
) -> tokio::task::JoinHandle<DownloadOutcome> {
    tokio::spawn(async move {
        let result =
            download_one(client.as_ref(), &url, header.as_ref(), &source_name).await;
        DownloadOutcome {
            idx,
            source_name,
            result,
        }
    })
}

async fn download_one(
    client: &reqwest::Client,
    url: &str,
    header: Option<&(String, String)>,
    name: &str,
) -> Result<(String, String), String> {
    let mut req = client.get(url).query(&[("name", name)]);
    if let Some((k, v)) = header {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    map_status(resp.status(), "download")?;
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let file_name = ensure_json_extension(basename(name));
    Ok((file_name, text))
}

// ---------------- helpers --------------------------------------------------

fn prepare_item(item: &Value, idx: usize) -> AuthFileInfo {
    let obj = item.as_object().cloned().unwrap_or_default();
    let str_field = |key: &str| -> String {
        obj.get(key)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let any_str = |keys: &[&str]| -> String {
        for k in keys {
            let v = str_field(k);
            if !v.is_empty() {
                return v;
            }
        }
        String::new()
    };
    let source_name = {
        let n = str_field("name");
        if !n.is_empty() {
            n
        } else {
            let id = str_field("id");
            if !id.is_empty() {
                id
            } else {
                format!("auth-file-{}.json", idx + 1)
            }
        }
    };
    let file_name = basename(&source_name);
    let modtime = any_str(&["modtime", "updated_at", "created_at"]);
    let modtime_ms = parse_iso_to_millis(&modtime);

    let plan_type = obj
        .get("id_token")
        .and_then(plan_from_id_token)
        .unwrap_or_default();

    AuthFileInfo {
        id: {
            let id = str_field("id");
            if !id.is_empty() {
                id
            } else {
                source_name.clone()
            }
        },
        source_name: source_name.clone(),
        file_name: if file_name.is_empty() {
            format!("auth-file-{}.json", idx + 1)
        } else {
            file_name
        },
        name: {
            let n = str_field("name");
            if !n.is_empty() {
                n
            } else {
                source_name.clone()
            }
        },
        r#type: any_str(&["type", "provider"]).to_lowercase(),
        status: str_field("status").to_lowercase(),
        account: any_str(&["account", "email", "label"]),
        label: str_field("label"),
        email: str_field("email"),
        size: obj.get("size").and_then(|v| v.as_u64()).unwrap_or(0),
        modtime,
        modtime_ms,
        plan_type: if plan_type.is_empty() {
            "unknown".to_string()
        } else {
            plan_type
        },
    }
}

fn parse_iso_to_millis(s: &str) -> i64 {
    if s.is_empty() {
        return 0;
    }
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.timestamp_millis())
        .unwrap_or(0)
}

fn basename(name: &str) -> String {
    let trimmed = name.trim();
    let last = trimmed
        .rsplit(|c| c == '/' || c == '\\')
        .next()
        .unwrap_or(trimmed);
    last.to_string()
}

fn ensure_json_extension(name: String) -> String {
    if name.to_lowercase().ends_with(".json") {
        name
    } else if name.is_empty() {
        "auth-file.json".to_string()
    } else {
        format!("{name}.json")
    }
}

fn unique_json_name(
    candidate: &str,
    fallback_idx: usize,
    used: &mut std::collections::HashSet<String>,
) -> String {
    let mut name = basename(candidate);
    name = name
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
                || (c as u32) < 0x20
            {
                '_'
            } else {
                c
            }
        })
        .collect::<String>();
    if name.is_empty() {
        name = format!("auth-file-{fallback_idx}.json");
    }
    if !name.to_lowercase().ends_with(".json") {
        name.push_str(".json");
    }
    let lower = name.to_lowercase();
    if !used.contains(&lower) {
        used.insert(lower);
        return name;
    }
    let (base, ext) = match name.rfind('.') {
        Some(i) => (&name[..i], &name[i..]),
        None => (name.as_str(), ""),
    };
    let mut count = 1;
    loop {
        count += 1;
        let candidate = format!("{base} ({count}){ext}");
        let lower = candidate.to_lowercase();
        if !used.contains(&lower) {
            used.insert(lower);
            return candidate;
        }
    }
}

fn build_sub2api_name(file_name: &str) -> String {
    let base = basename(file_name);
    let display = if base.is_empty() {
        "account.json".to_string()
    } else {
        base
    };
    if display.to_lowercase().starts_with("sub2api-") {
        display
    } else {
        format!("sub2api-{display}")
    }
}

fn timestamp_suffix() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

// ----------- ZIP (stored, no compression) ---------------------------------

fn build_zip(entries: &[(String, Vec<u8>)]) -> std::io::Result<Vec<u8>> {
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;
    use zip::CompressionMethod;

    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(Cursor::new(&mut buf));
        // Stored, not Deflated, to match the userscript (which hand-rolled
        // an uncompressed ZIP). Keeps payload byte-identical to user
        // expectations and saves a tiny amount of CPU.
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for (name, data) in entries {
            zip.start_file::<_, ()>(name.as_str(), opts)
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            zip.write_all(data)?;
        }
        zip.finish()
            .map_err(|e| std::io::Error::other(e.to_string()))?;
    }
    Ok(buf)
}

// ---------------- JWT + sub2api transform ---------------------------------

fn decode_b64url(input: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(input.trim_end_matches('='))
        .map_err(|e| format!("base64: {e}"))
}

fn parse_jwt_payload(token: &str, label: &str) -> Result<Value, String> {
    let raw = token.trim();
    let raw = raw
        .strip_prefix("bearer ")
        .or_else(|| raw.strip_prefix("Bearer "))
        .unwrap_or(raw)
        .trim();
    let parts: Vec<&str> = raw.split('.').collect();
    if parts.len() < 2 {
        return Err(format!("{label}: not a JWT"));
    }
    let bytes = decode_b64url(parts[1]).map_err(|e| format!("{label}: {e}"))?;
    let v: Value = serde_json::from_str(&String::from_utf8_lossy(&bytes))
        .map_err(|e| format!("{label}: {e}"))?;
    if !v.is_object() {
        return Err(format!("{label}: payload not an object"));
    }
    Ok(v)
}

fn plan_from_id_token(value: &Value) -> Option<String> {
    let raw = match value {
        Value::String(s) => s.clone(),
        Value::Object(_) => {
            // Already a parsed object.
            return Some(plan_from_obj(value).unwrap_or_default());
        }
        _ => return None,
    };
    if raw.trim().is_empty() {
        return None;
    }
    if let Ok(parsed) = serde_json::from_str::<Value>(&raw) {
        if let Some(p) = plan_from_obj(&parsed) {
            return Some(p);
        }
    }
    if raw.matches('.').count() >= 1 {
        if let Ok(payload) = parse_jwt_payload(&raw, "id_token") {
            return plan_from_obj(&payload);
        }
    }
    None
}

fn plan_from_obj(v: &Value) -> Option<String> {
    let direct = v
        .get("plan_type")
        .or_else(|| v.get("chatgpt_plan_type"))
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_lowercase());
    if let Some(p) = direct {
        if !p.is_empty() {
            return Some(p);
        }
    }
    let nested = v
        .get("https://api.openai.com/auth")
        .and_then(|x| x.get("chatgpt_plan_type"))
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_lowercase());
    nested.filter(|s| !s.is_empty())
}

fn first_path_str<'a>(v: &'a Value, paths: &[&[&str]]) -> Option<&'a str> {
    for path in paths {
        let mut cur = v;
        let mut ok = true;
        for k in *path {
            match cur.get(k) {
                Some(next) => cur = next,
                None => {
                    ok = false;
                    break;
                }
            }
        }
        if ok {
            if let Some(s) = cur.as_str() {
                let t = s.trim();
                if !t.is_empty() {
                    return Some(s);
                }
            }
        }
    }
    None
}

fn first_path_value<'a>(v: &'a Value, paths: &[&[&str]]) -> Option<&'a Value> {
    for path in paths {
        let mut cur = v;
        let mut ok = true;
        for k in *path {
            match cur.get(k) {
                Some(next) => cur = next,
                None => {
                    ok = false;
                    break;
                }
            }
        }
        if ok && !cur.is_null() {
            return Some(cur);
        }
    }
    None
}

fn extract_org_id(auth: Option<&Value>) -> String {
    let Some(auth) = auth else {
        return String::new();
    };
    for k in ["organization_id", "organizationId", "org_id"] {
        if let Some(s) = auth.get(k).and_then(|v| v.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    let orgs = auth.get("organizations");
    if let Some(arr) = orgs.and_then(|v| v.as_array()) {
        let default = arr.iter().find(|item| {
            item.get("is_default")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
                && item.get("id").is_some()
        });
        if let Some(item) = default {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                let t = id.trim();
                if !t.is_empty() {
                    return t.to_string();
                }
            }
        }
        for item in arr {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                let t = id.trim();
                if !t.is_empty() {
                    return t.to_string();
                }
            }
        }
    }
    if let Some(id) = orgs.and_then(|v| v.get("id")).and_then(|v| v.as_str()) {
        return id.trim().to_string();
    }
    String::new()
}

fn normalize_token(value: &str) -> String {
    let t = value.trim();
    let stripped = t
        .strip_prefix("bearer ")
        .or_else(|| t.strip_prefix("Bearer "))
        .unwrap_or(t)
        .trim();
    stripped.to_string()
}

fn transform_to_sub2api(
    source: &Value,
    file_name: &str,
    exported_at: &str,
) -> Result<String, String> {
    let access_paths: &[&[&str]] = &[
        &["access_token"],
        &["credentials", "access_token"],
        &["accessToken"],
        &["credentials", "accessToken"],
        &["tokens", "access_token"],
        &["auth", "access_token"],
        &["data", "access_token"],
    ];
    let refresh_paths: &[&[&str]] = &[
        &["refresh_token"],
        &["credentials", "refresh_token"],
        &["refreshToken"],
        &["credentials", "refreshToken"],
        &["tokens", "refresh_token"],
        &["auth", "refresh_token"],
        &["data", "refresh_token"],
    ];
    let id_token_paths: &[&[&str]] = &[
        &["id_token"],
        &["credentials", "id_token"],
        &["idToken"],
        &["credentials", "idToken"],
        &["tokens", "id_token"],
        &["auth", "id_token"],
        &["data", "id_token"],
    ];

    let access = first_path_str(source, access_paths)
        .map(normalize_token)
        .unwrap_or_default();
    let refresh = first_path_str(source, refresh_paths)
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let id_token = first_path_str(source, id_token_paths)
        .map(normalize_token)
        .unwrap_or_default();
    if access.is_empty() {
        return Err("missing access_token".into());
    }
    if refresh.is_empty() {
        return Err("missing refresh_token".into());
    }
    if id_token.is_empty() {
        return Err("missing id_token".into());
    }

    let access_payload = parse_jwt_payload(&access, "access_token")?;
    let id_payload = parse_jwt_payload(&id_token, "id_token")?;
    let access_auth = access_payload.get("https://api.openai.com/auth");
    let access_profile = access_payload.get("https://api.openai.com/profile");
    let id_auth = id_payload.get("https://api.openai.com/auth");

    let email = first_meaningful_str(&[
        first_path_str(source, &[&["email"], &["credentials", "email"]]).map(|s| s.to_string()),
        access_profile
            .and_then(|v| v.get("email"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        id_payload
            .get("email")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    ]);

    let expires_at = first_meaningful_value(&[
        access_payload.get("exp").cloned(),
        first_path_value(
            source,
            &[&["expires_at"], &["credentials", "expires_at"]],
        )
        .cloned(),
    ]);
    let expires_at_num = expires_at
        .as_ref()
        .and_then(|v| v.as_f64())
        .map(|n| n.round() as i64);

    let client_id = first_meaningful_str(&[
        access_payload
            .get("client_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        first_path_str(source, &[&["client_id"], &["credentials", "client_id"]])
            .map(|s| s.to_string()),
    ]);

    let chatgpt_account_id = first_meaningful_str(&[
        access_auth
            .and_then(|v| v.get("chatgpt_account_id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        id_auth
            .and_then(|v| v.get("chatgpt_account_id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        first_path_str(
            source,
            &[
                &["chatgpt_account_id"],
                &["credentials", "chatgpt_account_id"],
            ],
        )
        .map(|s| s.to_string()),
    ]);

    let chatgpt_user_id = first_meaningful_str(&[
        access_auth
            .and_then(|v| v.get("chatgpt_user_id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        id_auth
            .and_then(|v| v.get("chatgpt_user_id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    ]);

    let plan_type = first_meaningful_str(&[
        access_auth
            .and_then(|v| v.get("chatgpt_plan_type"))
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_lowercase()),
        id_auth
            .and_then(|v| v.get("chatgpt_plan_type"))
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_lowercase()),
    ]);

    let organization_id = {
        let v = extract_org_id(id_auth);
        if !v.is_empty() {
            v
        } else {
            extract_org_id(access_auth)
        }
    };

    let account_name = {
        let base = basename(file_name);
        let stripped = base.strip_suffix(".json").unwrap_or(&base);
        if stripped.is_empty() {
            "account".to_string()
        } else {
            stripped.to_string()
        }
    };

    let mut credentials = Map::new();
    credentials.insert("access_token".into(), Value::String(access));
    credentials.insert(
        "chatgpt_account_id".into(),
        Value::String(chatgpt_account_id),
    );
    credentials.insert("chatgpt_user_id".into(), Value::String(chatgpt_user_id));
    credentials.insert("client_id".into(), Value::String(client_id));
    credentials.insert("email".into(), Value::String(email.clone()));
    credentials.insert(
        "expires_at".into(),
        match expires_at_num {
            Some(n) => Value::Number(n.into()),
            None => Value::Null,
        },
    );
    credentials.insert("id_token".into(), Value::String(id_token));
    credentials.insert("organization_id".into(), Value::String(organization_id));
    credentials.insert("plan_type".into(), Value::String(plan_type));
    credentials.insert("refresh_token".into(), Value::String(refresh));

    let mut extra = Map::new();
    extra.insert("email".into(), Value::String(email));

    let mut account = Map::new();
    account.insert("name".into(), Value::String(account_name));
    account.insert("platform".into(), Value::String("openai".into()));
    account.insert("type".into(), Value::String("oauth".into()));
    account.insert("credentials".into(), Value::Object(credentials));
    account.insert("extra".into(), Value::Object(extra));
    account.insert("concurrency".into(), Value::Number(10.into()));
    account.insert("priority".into(), Value::Number(1.into()));
    account.insert("rate_multiplier".into(), Value::Number(1.into()));
    account.insert("auto_pause_on_expired".into(), Value::Bool(true));

    let mut root = Map::new();
    root.insert("exported_at".into(), Value::String(exported_at.into()));
    root.insert("proxies".into(), Value::Array(vec![]));
    root.insert("accounts".into(), Value::Array(vec![Value::Object(account)]));

    serde_json::to_string_pretty(&Value::Object(root)).map_err(|e| e.to_string())
}

fn first_meaningful_str(opts: &[Option<String>]) -> String {
    for o in opts {
        if let Some(s) = o {
            if !s.trim().is_empty() {
                return s.clone();
            }
        }
    }
    String::new()
}

fn first_meaningful_value(opts: &[Option<Value>]) -> Option<Value> {
    for o in opts {
        if let Some(v) = o {
            if !v.is_null() {
                return Some(v.clone());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_jwt(payload: Value) -> String {
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(b"{\"alg\":\"none\"}");
        let body = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&payload).unwrap());
        format!("{header}.{body}.")
    }

    #[test]
    fn basename_strips_paths() {
        assert_eq!(basename("a/b/c.json"), "c.json");
        assert_eq!(basename("a\\b.json"), "b.json");
        assert_eq!(basename("plain.json"), "plain.json");
    }

    #[test]
    fn unique_json_name_dedupes_case_insensitively() {
        let mut used = std::collections::HashSet::new();
        assert_eq!(unique_json_name("a.json", 1, &mut used), "a.json");
        assert_eq!(unique_json_name("A.JSON", 2, &mut used), "A (2).JSON");
    }

    #[test]
    fn build_sub2api_name_skips_existing_prefix() {
        assert_eq!(build_sub2api_name("foo.json"), "sub2api-foo.json");
        assert_eq!(build_sub2api_name("sub2api-foo.json"), "sub2api-foo.json");
    }

    #[test]
    fn transform_codex_round_trip() {
        let access = make_jwt(serde_json::json!({
            "exp": 1_750_000_000,
            "client_id": "abc",
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "acct-1",
                "chatgpt_user_id": "user-1",
                "chatgpt_plan_type": "PRO",
            },
            "https://api.openai.com/profile": { "email": "a@b.co" }
        }));
        let id_tok = make_jwt(serde_json::json!({
            "https://api.openai.com/auth": {
                "organizations": [
                    { "id": "org-default", "is_default": true },
                    { "id": "org-2" }
                ]
            }
        }));
        let source = serde_json::json!({
            "access_token": access,
            "refresh_token": "rt",
            "id_token": id_tok,
        });
        let out =
            transform_to_sub2api(&source, "alice.json", "2026-04-28T00:00:00Z").unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        let acct = &v["accounts"][0];
        assert_eq!(acct["name"], "alice");
        assert_eq!(acct["credentials"]["chatgpt_account_id"], "acct-1");
        assert_eq!(acct["credentials"]["organization_id"], "org-default");
        assert_eq!(acct["credentials"]["plan_type"], "pro");
        assert_eq!(acct["credentials"]["expires_at"], 1_750_000_000i64);
        assert_eq!(acct["credentials"]["email"], "a@b.co");
    }

    #[test]
    fn transform_rejects_missing_tokens() {
        let err = transform_to_sub2api(
            &serde_json::json!({"access_token": "x"}),
            "x.json",
            "ts",
        )
        .unwrap_err();
        assert!(err.contains("access_token") || err.contains("refresh_token"));
    }

    #[test]
    fn build_zip_round_trips() {
        let entries = vec![
            ("a.json".to_string(), b"{\"hello\":1}".to_vec()),
            ("b.txt".to_string(), b"plain".to_vec()),
        ];
        let bytes = build_zip(&entries).unwrap();
        let cursor = std::io::Cursor::new(&bytes);
        let mut zip = zip::ZipArchive::new(cursor).unwrap();
        assert_eq!(zip.len(), 2);
        let mut buf = String::new();
        use std::io::Read;
        zip.by_name("a.json").unwrap().read_to_string(&mut buf).unwrap();
        assert_eq!(buf, "{\"hello\":1}");
    }
}
