//! Módulo de descarga de archivos de guardado desde almacenamiento remoto.
//!
//! Implementa la lógica de recuperación de archivos desde la nube,
//! gestionando la transferencia, validación y almacenamiento local.
//!
//! Incluye soporte para seguimiento de progreso, manejo de errores
//! y reintentos con backoff exponencial en caso de fallos de acceso.

use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::time::{Duration, Instant, UNIX_EPOCH};

use chrono::{DateTime, Utc};
use futures_util::stream::{self, StreamExt};
use tokio::io::{AsyncWriteExt, BufWriter};

use super::api;
use super::backup;
use super::events::{
    emit_sync_download_done, emit_sync_download_progress, emit_sync_terminal,
    sync_status_from_err_count, sync_status_from_result,
};
use super::models::{
    ActiveDownloadStateDto, DownloadConflictDto, DownloadConflictsResultDto,
    GameConflictsResultDto, GameSyncResultDto, RemoteSaveInfoDto, SyncOperationStrategy,
    SyncProgressPayload, SyncResultDto, UnsyncedGameDto,
};
use crate::commands::logs::sync_logger;
use crate::network::DATA_CLIENT;
use crate::tray::tray_state::TrayState;
use crate::utils::path_utils;
use tauri::{AppHandle, State};

/// Número máximo de reintentos al intentar crear un archivo bloqueado.
const FILE_CREATE_MAX_RETRIES: u32 = 3;

/// Milisegundos base para el backoff exponencial al reintentar apertura de archivo.
///
/// El tiempo de espera real en el intento `n` es `FILE_CREATE_BACKOFF_BASE_MS * (n + 1)`.
const FILE_CREATE_BACKOFF_BASE_MS: u64 = 200;

/// Umbral en bytes entre emisiones sucesivas de eventos de progreso de descarga.
const DOWNLOAD_PROGRESS_EMIT_BYTES: u64 = 256 * 1024;
/// Umbral de emisión para archivos empaquetados grandes (.tar / backups/*).
const DOWNLOAD_PROGRESS_EMIT_BYTES_PACKAGED: u64 = 2 * 1024 * 1024;
/// Intervalo mínimo entre emisiones para evitar saturar IPC/UI.
const DOWNLOAD_PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(180);

/// Número máximo de descargas de archivos individuales en paralelo por juego.
const DOWNLOAD_FILE_CONCURRENCY: usize = 16;

/// Número máximo de juegos descargándose en paralelo en una operación batch.
const DOWNLOAD_BATCH_CONCURRENCY: usize = 4;

/// Número máximo de restauraciones de backups empaquetados en paralelo.
const RESTORE_PACKAGED_CONCURRENCY: usize = 2;

/// Tamaño del buffer de escritura a disco, en bytes.
const WRITE_BUF_SIZE: usize = 512 * 1024;

/// Tamaño máximo de un lote al solicitar URLs de descarga a la API.
const DOWNLOAD_URLS_BATCH_SIZE: usize = 500;

/// Tolerancia en segundos al comparar timestamps local vs. nube en la detección
/// de archivos sin sincronizar.
///
/// Solo se considera "pendiente de subir" si el archivo local es más reciente
/// que la versión en la nube por más de este margen, evitando falsos positivos
/// por diferencias de reloj o precisión de filesystem.
const UNSYNCED_LOCAL_NEWER_TOLERANCE_SECS: i64 = 2;

/// Determina si un error de I/O corresponde a acceso denegado o archivo en uso.
///
/// En Windows el código de error nativo 5 indica `ERROR_ACCESS_DENIED`,
/// que también aparece cuando otra aplicación mantiene un bloqueo exclusivo.
fn is_access_denied(e: &std::io::Error) -> bool {
    e.kind() == ErrorKind::PermissionDenied || e.raw_os_error() == Some(5)
}

/// Construye un mensaje de error legible cuando no se puede escribir un archivo.
///
/// Diferencia entre acceso denegado (archivo en uso o sin permisos) y otros
/// errores de I/O para orientar al usuario sobre cómo resolverlo.
fn file_write_error_message(filename: &str, e: &std::io::Error) -> String {
    if is_access_denied(e) {
        format!(
            "{}: archivo en uso o sin permisos (cierra el juego u otra app que lo use)",
            filename
        )
    } else {
        format!("{}: {}", filename, e)
    }
}

/// Intenta crear (o truncar) un archivo, reintentando con backoff exponencial
/// si el error indica que el archivo está bloqueado por otro proceso.
///
/// Se realizan hasta [`FILE_CREATE_MAX_RETRIES`] intentos. El tiempo de espera
/// entre intentos aumenta linealmente: `FILE_CREATE_BACKOFF_BASE_MS * (intento + 1)`.
///
/// # Errors
///
/// Devuelve `Err` con un mensaje legible si todos los reintentos fallan o si
/// el error no es de tipo acceso denegado.
async fn create_file_with_retry(path: &std::path::Path) -> Result<tokio::fs::File, std::io::Error> {
    let mut last_err: Option<std::io::Error> = None;

    for attempt in 0..FILE_CREATE_MAX_RETRIES {
        match tokio::fs::File::create(path).await {
            Ok(f) => return Ok(f),
            Err(e) => {
                let io_err = std::io::Error::from(e);
                if is_access_denied(&io_err) && attempt + 1 < FILE_CREATE_MAX_RETRIES {
                    let wait_ms = FILE_CREATE_BACKOFF_BASE_MS * (attempt as u64 + 1);
                    tokio::time::sleep(Duration::from_millis(wait_ms)).await;
                    last_err = Some(io_err);
                } else {
                    return Err(io_err);
                }
            }
        }
    }

    // Se llega aquí solo si todos los reintentos esperaron pero el último
    // intento no se ejecutó por la condición del bucle; devolvemos el último error.
    Err(last_err.expect("al menos un intento debe haberse realizado"))
}

/// Calcula los conflictos de descarga para un juego dado su ruta base y la lista
/// de guardados remotos.
///
/// Un conflicto ocurre cuando el archivo local existe y su fecha de modificación
/// es posterior a la del archivo en la nube, lo que indica que hay cambios locales
/// que se perderían al descargar.
///
/// # Arguments
///
/// * `dest_base` - Directorio raíz donde residen los archivos de guardado locales.
/// * `saves` - Lista de metadatos de archivos disponibles en la nube para este juego.
fn check_conflicts_for_game(
    dest_base: &std::path::Path,
    saves: &[RemoteSaveInfoDto],
) -> Vec<DownloadConflictDto> {
    let mut conflicts = Vec::new();

    for save in saves {
        let dest_path = dest_base.join(&save.filename);

        let Ok(meta) = fs::metadata(&dest_path) else {
            continue;
        };
        let Ok(local_mtime) = meta.modified() else {
            continue;
        };

        let cloud_dt: DateTime<Utc> = match DateTime::parse_from_rfc3339(&save.last_modified)
            .or_else(|_| DateTime::parse_from_rfc2822(&save.last_modified))
        {
            Ok(dt) => dt.with_timezone(&Utc),
            Err(_) => continue,
        };

        let Ok(duration) = local_mtime.duration_since(UNIX_EPOCH) else {
            continue;
        };
        let Some(local_dt) =
            DateTime::from_timestamp(duration.as_secs() as i64, duration.subsec_nanos())
        else {
            continue;
        };

        if local_dt > cloud_dt {
            conflicts.push(DownloadConflictDto {
                filename: save.filename.clone(),
                local_modified: local_dt.to_rfc3339(),
                cloud_modified: save.last_modified.clone(),
            });
        }
    }

    conflicts
}

/// Comprueba si existen conflictos de descarga para un juego concreto.
///
/// Obtiene la lista completa de guardados remotos, la filtra por `game_id` y
/// compara cada archivo con su versión local para detectar posibles pérdidas
/// de datos antes de proceder con la descarga.
///
/// # Errors
///
/// Devuelve `Err` si el juego no existe en la configuración, si la ruta no
/// puede expandirse o si la llamada a la API falla.
#[tauri::command]
pub async fn sync_check_download_conflicts(
    game_id: String,
) -> Result<DownloadConflictsResultDto, String> {
    let cfg = crate::config::load_config();
    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    let dest_base = match path_utils::expand_path(game.paths[0].trim()) {
        Some(p) => PathBuf::from(p),
        None => return Err("No se pudo expandir la ruta de destino".into()),
    };

    // Optimización: si ya conocemos el juego, listamos solo su prefijo remoto.
    let saves: Vec<RemoteSaveInfoDto> = api::sync_list_remote_saves_for_game(game_id.clone()).await?;

    let conflicts = check_conflicts_for_game(&dest_base, &saves);
    Ok(DownloadConflictsResultDto { conflicts })
}

/// Comprueba conflictos de descarga para varios juegos en una sola llamada a la API.
///
/// Realiza una única petición remota para obtener todos los guardados y luego
/// evalúa cada juego de la lista `game_ids` de forma local, evitando el
/// problema N+1 de peticiones que tendría llamar a [`sync_check_download_conflicts`]
/// de forma repetida.
///
/// Los juegos que no se encuentren en la configuración se incluyen en el
/// resultado con una lista de conflictos vacía.
///
/// # Errors
///
/// Devuelve `Err` si la llamada a la API falla. Los errores de expansión de
/// ruta por juego se tratan de forma individual y no abortan el proceso completo.
#[tauri::command]
pub async fn sync_check_download_conflicts_batch(
    game_ids: Vec<String>,
) -> Result<Vec<GameConflictsResultDto>, String> {
    if game_ids.is_empty() {
        return Ok(Vec::new());
    }

    let cfg = crate::config::load_config();
    let all = api::sync_list_remote_saves().await?;
    let mut results = Vec::with_capacity(game_ids.len());

    for game_id in game_ids {
        let game = match cfg
            .games
            .iter()
            .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        {
            Some(g) => g,
            None => {
                results.push(GameConflictsResultDto {
                    game_id,
                    conflicts: Vec::new(),
                });
                continue;
            }
        };

        let dest_base = match path_utils::expand_path(game.paths[0].trim()) {
            Some(p) => PathBuf::from(p),
            None => {
                results.push(GameConflictsResultDto {
                    game_id,
                    conflicts: Vec::new(),
                });
                continue;
            }
        };

        let saves: Vec<RemoteSaveInfoDto> = all
            .iter()
            .filter(|s| s.game_id.eq_ignore_ascii_case(&game_id))
            .cloned()
            .collect();

        let conflicts = check_conflicts_for_game(&dest_base, &saves);
        results.push(GameConflictsResultDto { game_id, conflicts });
    }

    Ok(results)
}

/// Devuelve los juegos que tienen al menos un archivo local más reciente que
/// su contraparte en la nube (o que no existe en la nube), indicando que
/// hay cambios pendientes de subir.
///
/// La comparación aplica una tolerancia de [`UNSYNCED_LOCAL_NEWER_TOLERANCE_SECS`]
/// para evitar falsos positivos por diferencias menores de reloj.
///
/// La enumeración de archivos locales se ejecuta en un thread de bloqueo
/// dedicado para no bloquear el runtime asíncrono de Tokio.
///
/// # Errors
///
/// Devuelve `Err` si `apiBaseUrl` o `userId` no están configurados, o si
/// la llamada a la API falla.
#[tauri::command]
pub async fn sync_check_unsynced_games() -> Result<Vec<UnsyncedGameDto>, String> {
    let cfg = crate::config::load_config();
    let tolerance_secs = UNSYNCED_LOCAL_NEWER_TOLERANCE_SECS;
    let tolerance = chrono::Duration::seconds(tolerance_secs);
    let game_ids: Vec<String> = cfg.games.iter().map(|g| g.id.clone()).collect();

    let (remote_files_res, remote_backups_res) = tokio::join!(
        api::sync_list_remote_saves(),
        super::full_backup::list_full_backups_batch(game_ids)
    );

    let remote_files = remote_files_res?;
    let remote_backups_map = remote_backups_res?;

    let remote_file_map: HashMap<(String, String), DateTime<Utc>> = remote_files
        .into_iter()
        .filter_map(|s| {
            let dt = DateTime::parse_from_rfc3339(&s.last_modified)
                .or_else(|_| DateTime::parse_from_rfc2822(&s.last_modified))
                .ok()?;
            Some((
                (s.game_id.to_lowercase(), s.filename),
                dt.with_timezone(&Utc),
            ))
        })
        .collect();

    let mut unsynced = Vec::new();

    for game in &cfg.games {
        let game_id_low = game.id.to_lowercase();

        let last_backup_dt = remote_backups_map.get(&game.id).and_then(|backups| {
            backups
                .iter()
                .filter_map(|b| {
                    DateTime::parse_from_rfc3339(&b.last_modified)
                        .or_else(|_| DateTime::parse_from_rfc2822(&b.last_modified))
                        .ok()
                })
                .map(|dt| dt.with_timezone(&Utc))
                .max()
        });

        let paths = game.paths.clone();
        let local_files = tokio::task::spawn_blocking(move || {
            crate::utils::path_utils::list_all_files_with_mtime(&paths)
        })
        .await
        .map_err(|e| format!("Error en scan local: {}", e))?;

        let mut has_unsynced = false;

        'files: for (_abs, rel, mtime, _size) in local_files {
            let Ok(duration) = mtime.duration_since(UNIX_EPOCH) else {
                continue;
            };
            let Some(local_dt) =
                DateTime::from_timestamp(duration.as_secs() as i64, duration.subsec_nanos())
            else {
                continue;
            };
            let local_dt = local_dt.with_timezone(&Utc);

            let key = (&game_id_low, rel.as_str());

            match remote_file_map.get(&(key.0.clone(), key.1.to_string())) {
                Some(&cloud_dt) => {
                    if local_dt > cloud_dt + tolerance {
                        if let Some(backup_dt) = last_backup_dt {
                            if local_dt > backup_dt + tolerance {
                                has_unsynced = true;
                                break 'files;
                            }
                        } else {
                            has_unsynced = true;
                            break 'files;
                        }
                    }
                }
                None => {
                    if let Some(backup_dt) = last_backup_dt {
                        if local_dt > backup_dt + tolerance {
                            has_unsynced = true;
                            break 'files;
                        }
                    } else {
                        has_unsynced = true;
                        break 'files;
                    }
                }
            }
        }

        if has_unsynced {
            unsynced.push(UnsyncedGameDto {
                game_id: game.id.clone(),
            });
        }
    }

    Ok(unsynced)
}

/// Descarga un único archivo desde la nube y lo escribe en el filesystem local.
///
/// El flujo es el siguiente:
/// 1. Crea los directorios padre si no existen.
/// 2. Si el archivo destino ya existe, realiza una copia de seguridad antes de
///    sobreescribirlo. La copia se hace con `fs::copy` directo; si el archivo
///    no existía en el momento de copiar (`NotFound`), se ignora silenciosamente.
/// 3. Descarga el contenido con streaming, emitiendo eventos de progreso cada
///    [`DOWNLOAD_PROGRESS_EMIT_BYTES`] bytes.
/// 4. Escribe con un [`BufWriter`] de [`WRITE_BUF_SIZE`] bytes para reducir
///    las llamadas de sistema.
/// 5. Ajusta la fecha de modificación del archivo al timestamp de la nube para
///    que las comparaciones posteriores sean coherentes.
///
/// La creación del archivo se reintenta con backoff exponencial si el sistema
/// reporta acceso denegado (archivo en uso por otro proceso).
///
/// # Arguments
///
/// * `dest_base` - Directorio raíz de guardados del juego.
/// * `backup_dir` - Directorio donde almacenar la copia previa, si se desea.
/// * `save` - Metadatos del archivo remoto a descargar.
/// * `download_url` - URL presignada para la descarga del contenido.
/// * `game_id` - Identificador del juego, usado en los eventos de progreso.
/// * `app` - Handle de la aplicación Tauri para emitir eventos al frontend.
///
/// # Errors
///
/// Devuelve `Err` con un mensaje legible si la petición HTTP falla, si no se
/// puede crear el archivo destino después de los reintentos, o si ocurre un
/// error de escritura durante la transferencia.
async fn download_one_file(
    dest_base: &std::path::Path,
    backup_dir: Option<&std::path::Path>,
    save: &RemoteSaveInfoDto,
    download_url: &str,
    game_id: &str,
    app: &AppHandle,
) -> Result<(), String> {
    let dest_path = dest_base.join(&save.filename);

    if let Some(parent) = dest_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // Copia de seguridad previa a la sobreescritura.
    // Se usa fs::copy directamente en lugar de exists() + copy() para evitar
    // una condición de carrera entre la comprobación y la copia.
    if let Some(backup_base) = backup_dir {
        if let Ok(rel) = dest_path.strip_prefix(dest_base) {
            let backup_path = backup_base.join(rel);
            if let Some(bp) = backup_path.parent() {
                let _ = fs::create_dir_all(bp);
            }
            match fs::copy(&dest_path, &backup_path) {
                Ok(_) => {}
                Err(e) if e.kind() == ErrorKind::NotFound => {}
                Err(e) => {
                    sync_logger::log_error(
                        "sync_download_game",
                        "download_one_file",
                        &format!("No se pudo hacer backup de '{}': {}", save.filename, e),
                    );
                }
            }
        }
    }

    let res = DATA_CLIENT
        .get(download_url)
        .send()
        .await
        .map_err(|e| format!("{}: {}", save.filename, e))?;

    let total = res.content_length().or(save.size).unwrap_or(0);
    let mut loaded: u64 = 0;
    let mut last_emit: u64 = 0;
    let mut last_emit_at = Instant::now();
    let is_packaged_backup =
        save.filename.starts_with("backups/") || save.filename.ends_with(".tar");
    let emit_bytes_threshold = if is_packaged_backup {
        DOWNLOAD_PROGRESS_EMIT_BYTES_PACKAGED
    } else {
        DOWNLOAD_PROGRESS_EMIT_BYTES
    };

    let file = create_file_with_retry(&dest_path)
        .await
        .map_err(|e| file_write_error_message(&save.filename, &e))?;

    let mut writer = BufWriter::with_capacity(WRITE_BUF_SIZE, file);
    let mut stream = res.bytes_stream();
    let mut write_err: Option<String> = None;

    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                loaded += chunk.len() as u64;

                let bytes_step = loaded.saturating_sub(last_emit) >= emit_bytes_threshold;
                let time_step = last_emit_at.elapsed() >= DOWNLOAD_PROGRESS_EMIT_INTERVAL;
                let done = total > 0 && loaded >= total;
                let should_emit = (bytes_step && time_step) || done;

                if should_emit {
                    last_emit = loaded;
                    last_emit_at = Instant::now();
                    emit_sync_download_progress(
                        app,
                        SyncProgressPayload {
                            operation_id: Some(format!("sync-download-{game_id}")),
                            status: Some("running".to_string()),
                            game_id: game_id.to_string(),
                            filename: save.filename.clone(),
                            loaded,
                            total,
                            downloaded_bytes: Some(loaded),
                            total_bytes: Some(total),
                            can_pause: None,
                            can_cancel: None,
                            can_resume: None,
                            strategy: Some(SyncOperationStrategy::DownloadFile),
                            state: None,
                            reason_code: None,
                        },
                    );
                }

                if let Err(e) = writer.write_all(&chunk).await {
                    write_err = Some(file_write_error_message(
                        &save.filename,
                        &std::io::Error::from(e),
                    ));
                    break;
                }
            }
            Err(e) => {
                write_err = Some(format!("{}: {}", save.filename, e));
                break;
            }
        }
    }

    // Emite el 100 % si la transferencia terminó correctamente pero el último
    // chunk no lo alcanzó exactamente por el umbral de emisión.
    if write_err.is_none() && total > 0 && loaded < total {
        emit_sync_download_progress(
            app,
            SyncProgressPayload {
                operation_id: Some(format!("sync-download-{game_id}")),
                status: Some("running".to_string()),
                game_id: game_id.to_string(),
                filename: save.filename.clone(),
                loaded: total,
                total,
                downloaded_bytes: Some(total),
                total_bytes: Some(total),
                can_pause: None,
                can_cancel: None,
                can_resume: None,
                strategy: Some(SyncOperationStrategy::DownloadFile),
                state: None,
                reason_code: None,
            },
        );
    }

    if write_err.is_none() {
        if let Err(e) = writer.flush().await {
            write_err = Some(file_write_error_message(
                &save.filename,
                &std::io::Error::from(e),
            ));
        }
    }

    // Libera el writer (y el file handle subyacente) antes de modificar
    // la fecha de modificación, para evitar conflictos en algunos sistemas.
    drop(writer);

    if write_err.is_none() {
        if let Ok(dt) = DateTime::parse_from_rfc3339(&save.last_modified)
            .or_else(|_| DateTime::parse_from_rfc2822(&save.last_modified))
        {
            let unix_secs = dt.timestamp();
            let unix_nanos = dt.timestamp_subsec_nanos();
            let ft = filetime::FileTime::from_unix_time(unix_secs, unix_nanos);
            let path_clone = dest_path.clone();

            // filetime::set_file_mtime es una llamada de sistema síncrona;
            // se delega a un thread de bloqueo para no interferir con Tokio.
            let set_result =
                tokio::task::spawn_blocking(move || filetime::set_file_mtime(&path_clone, ft))
                    .await;

            if let Err(e) = set_result {
                sync_logger::log_error(
                    "sync_download_game",
                    "download_one_file",
                    &format!("No se pudo ajustar mtime de '{}': {}", save.filename, e),
                );
            }
        }
    }

    match write_err {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// Descarga todos los archivos de guardado de un juego desde la nube.
///
/// Comando Tauri que envuelve [`sync_download_game_impl`] con gestión del
/// estado del tray y emisión del evento `sync-download-done` al finalizar.
///
/// # Errors
///
/// Propaga los errores de [`sync_download_game_impl`].
#[tauri::command]
pub async fn sync_download_game(
    game_id: String,
    app: AppHandle,
    tray_state: State<'_, TrayState>,
) -> Result<SyncResultDto, String> {
    tray_state.0.syncing_inc();
    tray_state.0.update_tooltip();

    let operation_id = format!("sync-download-{game_id}");
    let result = sync_download_game_impl(game_id.clone(), app.clone(), None).await;

    tray_state.0.syncing_dec();
    tray_state.0.clone().refresh_unsynced_async();
    let status = sync_status_from_result(&result);
    emit_sync_terminal(
        &app,
        operation_id,
        status,
        "download",
        Some(game_id.clone()),
        None,
        None,
    );
    emit_sync_download_done(&app);

    result
}

/// Implementación interna de la descarga de un juego.
///
/// Acepta una lista de guardados pre-obtenida (`prefetched_saves`) para
/// evitar el problema N+1 cuando se llama desde una operación batch: en ese
/// caso el llamador ya dispone de la lista completa y no es necesario hacer
/// una petición extra a la API por cada juego.
///
/// Si `prefetched_saves` es `None`, la función obtiene la lista por sí misma.
///
/// # Arguments
///
/// * `game_id` - Identificador del juego a descargar.
/// * `app` - Handle de la aplicación para emitir eventos de progreso.
/// * `prefetched_saves` - Lista de guardados remotos ya obtenida, o `None`.
///
/// # Errors
///
/// Devuelve `Err` si el juego está en ejecución, si la configuración es
/// incompleta, si la API falla o si no se pueden obtener las URLs de descarga.
pub(crate) async fn sync_download_game_impl(
    game_id: String,
    app: AppHandle,
    prefetched_saves: Option<Vec<RemoteSaveInfoDto>>,
) -> Result<SyncResultDto, String> {
    let cfg = crate::config::load_config();
    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    if crate::system::process_check::is_game_running(&game_id, &game.paths) {
        return Err(format!(
            "El juego está en ejecución. Cierra {} antes de descargar para evitar sobrescribir archivos en uso.",
            game.id
        ));
    }

    let api_base = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?;
    let user_id = cfg
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura userId en Configuración")?;
    let api_key = cfg.api_key.as_deref().unwrap_or("");

    let dest_base = match path_utils::expand_path(game.paths[0].trim()) {
        Some(p) => PathBuf::from(p),
        None => return Err("No se pudo expandir la ruta de destino".into()),
    };

    // Usa la lista provista por el llamador o la descarga si es una llamada individual.
    let saves: Vec<_> = match prefetched_saves {
        Some(s) => s,
        None => {
            // Optimización: lista solo los objetos del juego cuando es una operación individual.
            api::sync_list_remote_saves_for_game(game_id.clone()).await?
        }
    };

    if saves.is_empty() {
        let result = SyncResultDto {
            ok_count: 0,
            err_count: 0,
            errors: vec!["No hay guardados de este juego en la nube".into()],
        };
        let _ = crate::config::append_operation_log(
            "download",
            &game_id,
            result.ok_count,
            result.err_count,
        );
        return Ok(result);
    }

    let items: Vec<(String, String)> = saves
        .iter()
        .map(|s| (game_id.clone(), s.key.clone()))
        .collect();

    let mut download_urls = Vec::with_capacity(saves.len());
    for chunk in items.chunks(DOWNLOAD_URLS_BATCH_SIZE) {
        let batch = api::get_download_urls(api_base, user_id, api_key, chunk)
            .await
            .map_err(|e| format!("download-urls: {}", e))?;
        download_urls.extend(batch);
    }

    if download_urls.len() != saves.len() {
        return Err(format!(
            "API devolvió {} URLs para {} archivos",
            download_urls.len(),
            saves.len()
        ));
    }

    let backup_dir = crate::config::config_dir().map(|root| {
        let ts = chrono::Utc::now().format("%Y-%m-%d_%H-%M-%S");
        root.join("backups").join(&game_id).join(ts.to_string())
    });

    let results: Vec<Result<(), String>> = stream::iter(
        saves
            .into_iter()
            .zip(download_urls)
            .map(|(save, (download_url, _))| (save, download_url)),
    )
    .map(|(save, download_url)| {
        let dest_base = dest_base.clone();
        let backup_dir = backup_dir.clone();
        let game_id = game_id.clone();
        let app = app.clone();

        async move {
            download_one_file(
                &dest_base,
                backup_dir.as_deref(),
                &save,
                &download_url,
                &game_id,
                &app,
            )
            .await
        }
    })
    .buffer_unordered(DOWNLOAD_FILE_CONCURRENCY)
    .collect()
    .await;

    let ok_count = results.iter().filter(|r| r.is_ok()).count() as u32;
    let errors: Vec<String> = results.into_iter().filter_map(|r| r.err()).collect();
    let err_count = errors.len() as u32;

    let result = SyncResultDto {
        ok_count,
        err_count,
        errors,
    };

    let _ = crate::config::append_operation_log(
        "download",
        &game_id,
        result.ok_count,
        result.err_count,
    );

    if backup_dir.is_some() && result.err_count == 0 {
        let keep = cfg
            .keep_backups_per_game
            .unwrap_or(backup::DEFAULT_KEEP_BACKUPS_PER_GAME);
        let _ = backup::cleanup_old_backups(keep);
    }

    Ok(result)
}

/// Descarga los guardados de todos los juegos configurados desde la nube.
///
/// La estrategia es la siguiente:
/// 1. Los juegos actualmente en ejecución se marcan con error directamente,
///    sin intentar la descarga.
/// 2. Para los juegos restantes se comprueba si existe un backup empaquetado
///    reciente en la nube; si lo hay, se restaura (más eficiente para juegos
///    con muchos archivos). Si no, se descargan los archivos individuales.
/// 3. Las restauraciones de backups y las descargas individuales se realizan
///    en paralelo con concurrencias configuradas por [`RESTORE_PACKAGED_CONCURRENCY`]
///    y [`DOWNLOAD_BATCH_CONCURRENCY`] respectivamente.
/// 4. La lista de guardados individuales se obtiene una sola vez y se
///    distribuye entre los juegos que la necesitan, evitando N peticiones.
///
/// Al finalizar se actualiza el tray, se emite `sync-download-done` y se
/// limpian backups antiguos según la política de retención configurada.
///
/// # Errors
///
/// Devuelve `Err` si `apiBaseUrl` o `userId` no están configurados.
/// Los errores individuales por juego se incluyen en el resultado sin abortar
/// la operación completa.
#[tauri::command]
pub async fn sync_download_all_games(
    app: AppHandle,
    tray_state: State<'_, TrayState>,
) -> Result<Vec<GameSyncResultDto>, String> {
    let cfg = crate::config::load_config();

    let api_base = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?;
    let user_id = cfg
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura userId en Configuración")?;
    let api_key = cfg.api_key.as_deref().unwrap_or("");

    tray_state.0.syncing_inc();
    tray_state.0.update_tooltip();

    // Marca como error los juegos que están en ejecución antes de intentar nada.
    let mut results_by_id: HashMap<String, GameSyncResultDto> = cfg
        .games
        .iter()
        .filter(|g| crate::system::process_check::is_game_running(&g.id, &g.paths))
        .map(|g| {
            let dto = GameSyncResultDto {
                game_id: g.id.clone(),
                result: SyncResultDto {
                    ok_count: 0,
                    err_count: 1,
                    errors: vec![format!(
                        "{} está en ejecución. Ciérralo antes de descargar.",
                        g.id
                    )],
                },
            };
            (g.id.clone(), dto)
        })
        .collect();

    let to_process: Vec<String> = cfg
        .games
        .iter()
        .filter(|g| !results_by_id.contains_key(&g.id))
        .map(|g| g.id.clone())
        .collect();

    let api_base_owned = api_base.to_string();
    let user_id_owned = user_id.to_string();

    // Consulta en paralelo si existe un backup empaquetado para cada juego.
    let backups_fetched: Vec<(String, Option<String>)> = stream::iter(to_process.clone())
        .map(|game_id| {
            let api_base = api_base_owned.clone();
            let user_id = user_id_owned.clone();
            async move {
                let list =
                    super::full_backup::list_cloud_backups(&api_base, &user_id, api_key, &game_id)
                        .await
                        .ok()
                        .filter(|l| !l.is_empty());

                let backup_key = list.and_then(|mut list| {
                    list.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
                    list.into_iter().next().map(|b| b.key)
                });

                (game_id, backup_key)
            }
        })
        .buffer_unordered(8)
        .collect()
        .await;

    let mut to_restore = Vec::new();
    let mut to_download_normal = Vec::new();

    for (id, key_opt) in backups_fetched {
        match key_opt {
            Some(k) => to_restore.push((id, k)),
            None => to_download_normal.push(id),
        }
    }

    let tray_inner = tray_state.0.clone();

    // Restaura backups empaquetados en paralelo.
    let restore_results: Vec<(String, Result<SyncResultDto, String>)> = stream::iter(to_restore)
        .map(|(game_id, backup_key)| {
            let app = app.clone();
            let tray = tray_inner.clone();
            async move {
                let r = super::full_backup::download_and_restore_full_backup_impl(
                    game_id.clone(),
                    backup_key,
                    app,
                    tray,
                    false,
                )
                .await;

                let result = match r {
                    Ok(()) => SyncResultDto {
                        ok_count: 1,
                        err_count: 0,
                        errors: vec![],
                    },
                    Err(e) => SyncResultDto {
                        ok_count: 0,
                        err_count: 1,
                        errors: vec![e],
                    },
                };
                (game_id, Ok(result))
            }
        })
        .buffer_unordered(RESTORE_PACKAGED_CONCURRENCY)
        .collect()
        .await;

    for (game_id, r) in restore_results {
        let result = r.unwrap_or_else(|e| SyncResultDto {
            ok_count: 0,
            err_count: 1,
            errors: vec![e],
        });
        results_by_id.insert(game_id.clone(), GameSyncResultDto { game_id, result });
    }

    // Obtiene la lista remota una sola vez para todos los juegos de descarga normal.
    let all_saves = if !to_download_normal.is_empty() {
        match api::sync_list_remote_saves().await {
            Ok(s) => s,
            Err(e) => {
                for game_id in to_download_normal {
                    results_by_id.insert(
                        game_id.clone(),
                        GameSyncResultDto {
                            game_id,
                            result: SyncResultDto {
                                ok_count: 0,
                                err_count: 1,
                                errors: vec![format!("Fallo al contactar API: {}", e)],
                            },
                        },
                    );
                }
                // Devuelve los resultados en el orden original de la configuración.
                tray_state.0.syncing_dec();
                tray_state.0.clone().refresh_unsynced_async();
                for dto in results_by_id.values() {
                    let status = sync_status_from_err_count(dto.result.err_count);
                    emit_sync_terminal(
                        &app,
                        format!("sync-download-{}", dto.game_id),
                        status,
                        "download",
                        Some(dto.game_id.clone()),
                        None,
                        None,
                    );
                }
                emit_sync_download_done(&app);
                return Ok(cfg
                    .games
                    .iter()
                    .filter_map(|g| results_by_id.get(&g.id).cloned())
                    .collect());
            }
        }
    } else {
        Vec::new()
    };

    // Descarga archivos individuales en paralelo, distribuyendo la lista remota
    // ya obtenida para evitar una petición extra por juego.
    let completed: Vec<(String, Result<SyncResultDto, String>)> = stream::iter(to_download_normal)
        .map(|game_id| {
            let app = app.clone();
            let game_saves: Vec<_> = all_saves
                .iter()
                .filter(|s| s.game_id.eq_ignore_ascii_case(&game_id))
                .cloned()
                .collect();

            async move {
                let r = sync_download_game_impl(game_id.clone(), app, Some(game_saves)).await;
                (game_id, r)
            }
        })
        .buffer_unordered(DOWNLOAD_BATCH_CONCURRENCY)
        .collect()
        .await;

    for (game_id, r) in completed {
        let result = r.unwrap_or_else(|e| SyncResultDto {
            ok_count: 0,
            err_count: 1,
            errors: vec![e],
        });
        results_by_id.insert(game_id.clone(), GameSyncResultDto { game_id, result });
    }

    // Reordena los resultados según el orden de la configuración para consistencia.
    let results: Vec<GameSyncResultDto> = cfg
        .games
        .iter()
        .map(|g| results_by_id.get(&g.id).cloned().expect("result per game"))
        .collect();

    tray_state.0.syncing_dec();
    tray_state.0.clone().refresh_unsynced_async();
    for dto in &results {
        let status = sync_status_from_err_count(dto.result.err_count);
        emit_sync_terminal(
            &app,
            format!("sync-download-{}", dto.game_id),
            status,
            "download",
            Some(dto.game_id.clone()),
            None,
            None,
        );
    }
    emit_sync_download_done(&app);

    let keep = cfg
        .keep_backups_per_game
        .unwrap_or(backup::DEFAULT_KEEP_BACKUPS_PER_GAME);
    let _ = backup::cleanup_old_backups(keep);

    Ok(results)
}

#[tauri::command]
pub async fn get_active_downloads_state() -> Result<Vec<ActiveDownloadStateDto>, String> {
    // Por ahora sync solo expone eventos push de progreso.
    // Este endpoint permite rehidratación futura sin romper contrato.
    Ok(Vec::new())
}
