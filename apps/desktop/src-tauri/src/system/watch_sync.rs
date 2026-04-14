//! Observador de sistema de archivos para la sincronización activa en segundo plano.
//!
//! Provee un mecanismo de vigilancia que detecta modificaciones en los archivos
//! de guardado locales. Utiliza una cola con "debounce" (retraso acumulativo)
//! de 5 minutos para agrupar ráfagas de autoguardados, asegurando que las
//! sincronizaciones ocurran en momentos de inactividad del disco sin penalizar
//! el rendimiento del juego en ejecución.
//!
//! Deshabilitado temporalmente vía macro en entornos específicos; remover
//! `#![allow(dead_code)]` cuando se integre al flujo principal.
#![allow(dead_code)]
use crate::commands::logs::sync_logger;
use crate::commands::sync::{self};
use crate::config;
use notify::{RecursiveMode, Watcher};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time::Instant;

/// Resuelve interpolaciones de entorno (ej. `%APPDATA%`) y atajos (ej. `~`)
/// devolviendo una ruta física absoluta y evaluable por el sistema operativo.
///
/// # Arguments
///
/// * `raw` - Cadena de texto representativa de la ruta sin procesar.
///
/// # Returns
///
/// Devuelve `Some(PathBuf)` si la expansión resulta en una ruta válida,
/// o `None` si la cadena está vacía o malformada.
fn expand_path(raw: &str) -> Option<PathBuf> {
    let mut result = raw.to_string();
    let re = regex::Regex::new(r"%([^%]+)%").ok()?;

    for cap in re.captures_iter(raw) {
        let var = cap.get(1)?.as_str();
        let val = std::env::var(var).unwrap_or_default();
        result = result.replace(&format!("%{}%", var), &val);
    }

    if result.starts_with('~') {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default();

        if !home.is_empty() {
            let rest = result.trim_start_matches('~').trim_start_matches('/');
            result = if rest.is_empty() {
                home
            } else {
                format!("{}/{}", home.trim_end_matches(&['/', '\\']), rest)
            };
        }
    }

    if result.is_empty() {
        None
    } else {
        Some(PathBuf::from(result))
    }
}

/// Cruza un evento de modificación del sistema de archivos contra el registro
/// de directorios vigilados para identificar qué juego originó el cambio.
///
/// Selecciona la coincidencia más profunda (el directorio más específico) en caso
/// de que existan rutas anidadas entre distintos juegos.
///
/// # Arguments
///
/// * `path` - Ruta del archivo modificado notificada por el evento del OS.
/// * `watch_roots` - Matriz de tuplas vinculando rutas raíz con identificadores lógicos.
fn path_to_game_id(path: &Path, watch_roots: &[(PathBuf, String)]) -> Option<String> {
    let path = path.canonicalize().ok()?;
    let mut best: Option<(PathBuf, String)> = None;

    for (root, game_id) in watch_roots {
        let Ok(canon_root) = root.canonicalize() else {
            continue;
        };

        if path.starts_with(&canon_root) {
            match &best {
                None => best = Some((canon_root, game_id.clone())),
                Some((prev, _)) => {
                    if canon_root.as_os_str().len() > prev.as_os_str().len() {
                        best = Some((canon_root, game_id.clone()));
                    }
                }
            }
        }
    }
    best.map(|(_, id)| id)
}

/// Inicializa el motor de vigilancia y su procesador de cola asíncrono subyacente.
///
/// Evalúa el manifiesto local, descarta rutas inexistentes o inválidas y vincula
/// un descriptor de inotify/ReadDirectoryChangesW a los directorios resultantes.
///
/// Los eventos interceptados no disparan acciones directas; en su lugar, retroceden
/// un temporizador por cada juego afectado. Solo cuando el temporizador expira (ausencia
/// de actividad I/O continua), se emite la orden de subida a S3.
///
/// # Arguments
///
/// * `app` - Handle principal de Tauri para despachar notificaciones a la interfaz.
/// * `tray_state` - Referencia atómica al estado del ícono de bandeja del sistema.
pub fn spawn_watcher(app: AppHandle, tray_state: Arc<crate::tray::tray_state::TrayStateInner>) {
    let cfg = config::load_config();

    if cfg
        .api_base_url
        .as_ref()
        .map_or(true, |s| s.trim().is_empty())
        || cfg.user_id.as_ref().map_or(true, |s| s.trim().is_empty())
    {
        return;
    }

    let mut watch_roots: Vec<(PathBuf, String)> = Vec::new();
    let mut unique_dirs: HashSet<PathBuf> = HashSet::new();

    // Resolver y normalizar las rutas objetivo configuradas
    for game in &cfg.games {
        for raw in &game.paths {
            let Some(expanded) = expand_path(raw.trim()) else {
                continue;
            };
            if !expanded.exists() {
                continue;
            }

            let watch_dir = if expanded.is_file() {
                expanded.parent().map(PathBuf::from).unwrap_or(expanded)
            } else {
                expanded
            };

            unique_dirs.insert(watch_dir.clone());
            watch_roots.push((watch_dir, game.id.clone()));
        }
    }

    if watch_roots.is_empty() {
        return;
    }

    let (tx, mut rx) = mpsc::channel::<notify::Result<notify::Event>>(1024);

    let mut watcher = match notify::recommended_watcher(move |res| {
        // try_send descarta eventos silenciosamente si la cola está llena,
        // previniendo bloqueos en el hilo del sistema de archivos.
        let _ = tx.try_send(res);
    }) {
        Ok(w) => w,
        Err(e) => {
            sync_logger::log_error(
                "watch_sync",
                "Impossible to instantiate the OS watcher",
                &e.to_string(),
            );
            return;
        }
    };

    // Suscribir el observador a cada directorio único resuelto
    for dir in &unique_dirs {
        if let Err(e) = watcher.watch(dir, RecursiveMode::Recursive) {
            sync_logger::log_error(
                "watch_sync",
                &format!("Unable to link watch to {:?}", dir.to_string_lossy()),
                &e.to_string(),
            );
        }
    }

    // Bucle asíncrono procesador de eventos (Debouncer Lógico)
    tauri::async_runtime::spawn(async move {
        // Mantiene el watcher vivo durante la vida del task
        let _kept_alive_watcher = watcher;

        let mut pending_uploads: HashMap<String, Instant> = HashMap::new();
        // Registro de juegos que se están subiendo actualmente para evitar bucles infinitos
        let active_syncs: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));

        // Periodo de gracia tras el último archivo modificado antes de efectuar la subida
        let debounce_duration: Duration = Duration::from_secs(300);
        let audit_interval: Duration = Duration::from_secs(10);

        loop {
            tokio::select! {
                // 1. Ingesta de notificaciones: Solo insertamos o actualizamos el tiempo
                Some(res) = rx.recv() => {
                    if let Ok(event) = res {
                        for path in event.paths {
                            if let Some(game_id) = path_to_game_id(&path, &watch_roots) {
                                let is_syncing = {
                                    active_syncs.lock().unwrap().contains(&game_id)
                                };

                                if !is_syncing {
                                    pending_uploads.insert(game_id, Instant::now() + debounce_duration);
                                }
                            }
                        }
                    }
                }

                // 2. Auditoría: Revisamos quiénes ya cumplieron su tiempo de espera
                _ = tokio::time::sleep(audit_interval) => {
                    let now = Instant::now();
                    let mut games_to_process = Vec::new();

                    // Recolectamos solo los que ya expiraron
                    for (game_id, deadline) in &pending_uploads {
                        if now >= *deadline {
                            games_to_process.push(game_id.clone());
                        }
                    }

                    // Los eliminamos de la cola de espera inmediatamente
                    for game_id in &games_to_process {
                        pending_uploads.remove(game_id);
                    }

                    // Ejecutamos las subidas para los juegos que salieron de la lista
                    for game_id in games_to_process {
                        if tray_state.was_just_restored(&game_id) {
                            continue;
                        }

                        let app_clone = app.clone();
                        let tray_clone = tray_state.clone();
                        let gid = game_id.clone();
                        let active_syncs_clone = active_syncs.clone();

                        // Marcamos el juego como ocupado en la sincronización
                        active_syncs_clone.lock().unwrap().insert(gid.clone());

                        tray_clone.syncing_inc();
                        tray_clone.update_tooltip();

                        tauri::async_runtime::spawn(async move {
                            let res = sync::upload::sync_upload_game_impl(
                                gid.clone(),
                                app_clone.clone(),
                                None
                            ).await;

                            // Al terminar, liberamos el juego para que el watcher pueda volver a escucharlo
                            active_syncs_clone.lock().unwrap().remove(&gid);

                            tray_clone.syncing_dec();
                            tray_clone.clone().refresh_unsynced_async();

                            match res {
                                Ok(r) => {
                                    let _ = app_clone.emit("auto-sync-done", PayloadDone {
                                        game_id: gid,
                                        ok_count: r.ok_count,
                                        err_count: r.err_count
                                    });
                                }
                                Err(e) => {
                                    let _ = app_clone.emit("auto-sync-error", PayloadError {
                                        game_id: gid,
                                        error: e
                                    });
                                }
                            }
                        });
                    }
                }
            }
        }
    });
}

// Estructuras de carga útil (Payloads) para eventos IPC hacia el frontend

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PayloadDone {
    game_id: String,
    ok_count: u32,
    err_count: u32,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PayloadError {
    game_id: String,
    error: String,
}
