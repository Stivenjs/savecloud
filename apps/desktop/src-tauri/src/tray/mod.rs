//! Módulo para crear el tray.
//!
//! Contiene las funciones para:
//!
//! - Crear el tray.
//! - Mostrar el tray.
//! - Subir todo.
//! - Descargar todo.
//! - Backup completo (primer juego).
//! - Salir.    

pub mod tray_state;
pub mod tray_tooltip;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, Emitter, Manager};

use tray_state::TrayState;

pub fn create_tray(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let icon_bytes = include_bytes!("../../icons/icon.ico");
    let icon = tauri::image::Image::from_bytes(icon_bytes)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    let show_item = MenuItem::with_id(app, "show", "Mostrar", true, None::<&str>)?;
    let upload_all_item =
        MenuItem::with_id(app, "upload_all", "Subir todo ahora", true, None::<&str>)?;
    let download_all_item = MenuItem::with_id(
        app,
        "download_all",
        "Descargar todo ahora",
        true,
        None::<&str>,
    )?;
    let backup_first_item = MenuItem::with_id(
        app,
        "backup_first",
        "Backup completo (primer juego)",
        true,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &upload_all_item,
            &download_all_item,
            &backup_first_item,
            &quit_item,
        ],
    )?;

    let tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("Listo")
        .on_menu_event(move |app, event| {
            let id = event.id.as_ref();

            match id {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if let Err(e) = window.show() {
                            eprintln!("Error mostrando ventana: {}", e);
                        }
                        let _ = window.set_focus();
                    }
                }

                "quit" => {
                    let handle = app.app_handle().clone();

                    std::thread::spawn(move || {
                        println!("Iniciando cierre limpio...");

                        handle.exit(0);

                        std::thread::sleep(std::time::Duration::from_secs(5));

                        eprintln!("Forzando cierre de la aplicación...");
                        std::process::exit(0);
                    });
                }

                "upload_all" => {
                    if let Err(e) = app.emit("tray-action-upload-all", ()) {
                        eprintln!("Error emitiendo upload_all: {}", e);
                    }
                }

                "download_all" => {
                    if let Err(e) = app.emit("tray-action-download-all", ()) {
                        eprintln!("Error emitiendo download_all: {}", e);
                    }
                }

                "backup_first" => {
                    if let Err(e) = app.emit("tray-action-backup-first", ()) {
                        eprintln!("Error emitiendo backup_first: {}", e);
                    }
                }

                _ => {}
            }
        })
        .build(app)?;

    let tray_state = TrayState::new(tray);
    app.manage(tray_state);

    Ok(())
}
