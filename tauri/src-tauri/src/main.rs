// Hide the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use std::path::PathBuf;

#[derive(Deserialize)]
struct Filter {
    name: String,
    extensions: Vec<String>,
}

#[tauri::command]
fn pick_file(filters: Option<Vec<Filter>>) -> Option<String> {
    let mut dlg = rfd::FileDialog::new();
    if let Some(fs) = filters {
        for f in fs {
            let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            dlg = dlg.add_filter(&f.name, &exts);
        }
    }
    dlg.pick_file().map(|p| p.display().to_string())
}

#[tauri::command]
fn read_file(path: PathBuf) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_file(
    default_name: String,
    filters: Option<Vec<Filter>>,
    data: Vec<u8>,
) -> Result<Option<String>, String> {
    let mut dlg = rfd::FileDialog::new().set_file_name(&default_name);
    if let Some(fs) = filters {
        for f in fs {
            let exts: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            dlg = dlg.add_filter(&f.name, &exts);
        }
    }
    match dlg.save_file() {
        Some(p) => {
            std::fs::write(&p, &data).map_err(|e| e.to_string())?;
            Ok(Some(p.display().to_string()))
        }
        None => Ok(None),
    }
}

fn main() {
    // WebKitGTK's DMABUF renderer is broken under Wayland on several drivers,
    // producing "Error 71 (Protocol error) dispatching to Wayland display".
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![pick_file, read_file, save_file])
        .run(tauri::generate_context!())
        .expect("error while running pdf-signer");
}
