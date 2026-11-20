// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::borrow::Cow;

use serde::Deserialize;
use tauri::{
    http::{header, Request, Response},
    webview::NewWindowResponse,
    Url, WebviewWindowBuilder,
};

#[derive(Deserialize)]
struct Filter {
    name: String,
    extensions: Vec<String>,
}

#[tauri::command]
async fn save_file(
    default_name: String,
    filters: Option<Vec<Filter>>,
    data: Vec<u8>,
) -> Result<bool, String> {
    let mut dialog = rfd::AsyncFileDialog::new().set_file_name(default_name);
    for filter in filters.unwrap_or_default() {
        dialog = dialog.add_filter(filter.name, &filter.extensions);
    }
    let Some(file) = dialog.save_file().await else {
        return Ok(false);
    };
    let path = file.path().to_owned();
    tauri::async_runtime::spawn_blocking(move || std::fs::write(path, data))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    Ok(true)
}

fn is_app_url(url: &Url) -> bool {
    matches!(
        (url.scheme(), url.host_str()),
        ("tauri", Some("localhost")) | ("http" | "https", Some("tauri.localhost"))
    )
}

fn open_external(url: &Url) {
    if url.scheme() == "https" && url.host_str().is_some() {
        if let Err(error) = open::that_detached(url.as_str()) {
            eprintln!("Could not open link: {error}");
        }
    }
}

fn allow_desktop_ipc(_request: Request<Vec<u8>>, response: &mut Response<Cow<'static, [u8]>>) {
    if !response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("text/html"))
    {
        return;
    }
    let Ok(html) = std::str::from_utf8(response.body()) else {
        return;
    };
    let html = html.replacen(
        "connect-src 'self' https:;",
        "connect-src 'self' https: ipc: http://ipc.localhost https://ipc.localhost;",
        1,
    );
    response.headers_mut().remove(header::CONTENT_LENGTH);
    *response.body_mut() = Cow::Owned(html.into_bytes());
}

fn main() {
    // Work around a WebKitGTK renderer issue on some Wayland systems.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![save_file])
        .setup(|app| {
            let config = &app.config().app.windows[0];
            WebviewWindowBuilder::from_config(app, config)?
                .on_web_resource_request(allow_desktop_ipc)
                .on_navigation(|url| {
                    let local = is_app_url(url);
                    if !local {
                        open_external(url);
                    }
                    local
                })
                .on_new_window(|url, _| {
                    open_external(&url);
                    NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running pdf-signer");
}
