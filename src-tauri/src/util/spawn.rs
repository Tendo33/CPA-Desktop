use std::future::Future;

/// Like `tauri::async_runtime::spawn`, but logs panics instead of swallowing them.
pub fn supervised<F>(fut: F)
where
    F: Future<Output = ()> + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let result = futures_util::FutureExt::catch_unwind(std::panic::AssertUnwindSafe(fut)).await;
        if let Err(panic) = result {
            let msg = match panic.downcast_ref::<&'static str>() {
                Some(s) => (*s).to_string(),
                None => match panic.downcast_ref::<String>() {
                    Some(s) => s.clone(),
                    None => "<non-string panic>".to_string(),
                },
            };
            log::error!("supervised future panicked: {msg}");
        }
    });
}
