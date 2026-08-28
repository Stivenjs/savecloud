//! Módulo para la gestión y subida de clips de juego.
//!
//! Este módulo permite a los usuarios:
//! - Subir archivos de vídeo (.mp4, .webm, .mov, .mkv) mediante streaming O(1) con reporte a la barra global.
//! - Consultar la lista de clips subidos para un juego o de su cuenta.
//! - Eliminar clips existentes tanto de S3 como de la base de datos de metadatos.

use crate::commands::sync::events::{
    emit_sync_terminal, emit_sync_upload_done, emit_sync_upload_progress,
};
use crate::commands::sync::models::{
    SyncOperationState, SyncOperationStrategy, SyncProgressPayload,
};
use crate::network::{API_CLIENT, DATA_CLIENT};
use bytes::Bytes;
use futures_util::stream::Stream;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufReader, Read};
use std::path::Path;
use std::pin::Pin;
use std::task::{Context, Poll};
use tauri::{command, AppHandle};
use tokio::sync::mpsc;

/// Tamaño del chunk para el reporte de progreso y lectura en buffer (256 KB).
const PROGRESS_CHUNK_BYTES: usize = 256 * 1024;

/// Stream personalizado que lee el archivo en chunks y reporta progreso al frontend.
struct ClipProgressStream {
    rx: mpsc::Receiver<Result<Bytes, std::io::Error>>,
}

impl Stream for ClipProgressStream {
    type Item = Result<Bytes, std::io::Error>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.rx.poll_recv(cx)
    }
}

/// Crea un stream para la subida de archivos que emite eventos de progreso a la barra general de SaveCloud.
fn create_clip_progress_stream(
    file_path: &Path,
    total_bytes: u64,
    app: AppHandle,
    game_id: String,
    filename: String,
    operation_id: String,
) -> Result<ClipProgressStream, String> {
    let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(4);
    let path_buf = file_path.to_path_buf();

    std::thread::spawn(move || {
        let file = match fs::File::open(&path_buf) {
            Ok(f) => f,
            Err(e) => {
                let _ = tx.blocking_send(Err(e));
                return;
            }
        };

        let mut reader = BufReader::with_capacity(PROGRESS_CHUNK_BYTES, file);
        let mut loaded: u64 = 0;
        let mut last_emit: u64 = 0;
        let mut buffer = vec![0u8; PROGRESS_CHUNK_BYTES];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(bytes_read) => {
                    loaded += bytes_read as u64;

                    // Emitir evento a la barra global si se superó el chunk o si se completó
                    if loaded - last_emit >= PROGRESS_CHUNK_BYTES as u64
                        || (total_bytes > 0 && loaded >= total_bytes)
                    {
                        last_emit = loaded;
                        emit_sync_upload_progress(
                            &app,
                            SyncProgressPayload {
                                operation_id: Some(operation_id.clone()),
                                status: Some("running".to_string()),
                                game_id: game_id.clone(),
                                filename: format!("Clip: {}", filename),
                                loaded,
                                total: total_bytes,
                                downloaded_bytes: Some(loaded),
                                total_bytes: Some(total_bytes),
                                can_pause: Some(false),
                                can_cancel: Some(false),
                                can_resume: Some(false),
                                strategy: Some(SyncOperationStrategy::Streaming),
                                state: Some(SyncOperationState::Running),
                                reason_code: None,
                            },
                        );
                    }

                    let chunk = Bytes::copy_from_slice(&buffer[..bytes_read]);
                    if tx.blocking_send(Ok(chunk)).is_err() {
                        // El receptor HTTP abortó la conexión
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx.blocking_send(Err(e));
                    break;
                }
            }
        }
    });

    Ok(ClipProgressStream { rx })
}

/// Datos enviados a la API para solicitar la URL de subida de un clip.
#[derive(Debug, Serialize)]
struct ClipUploadRequest<'a> {
    #[serde(rename = "gameId")]
    game_id: &'a str,
    filename: &'a str,
    #[serde(rename = "contentType")]
    content_type: &'a str,
    #[serde(rename = "posterUrl", skip_serializing_if = "Option::is_none")]
    poster_url: Option<&'a str>,
    #[serde(rename = "steamAppId", skip_serializing_if = "Option::is_none")]
    steam_app_id: Option<&'a str>,
    #[serde(rename = "gameTitle", skip_serializing_if = "Option::is_none")]
    game_title: Option<&'a str>,
    #[serde(rename = "thumbnailBase64", skip_serializing_if = "Option::is_none")]
    thumbnail_base64: Option<&'a str>,
}

/// Respuesta recibida de la API al solicitar la subida de un clip.
#[derive(Debug, Deserialize)]
struct ClipUploadApiResponse {
    #[serde(rename = "clipId")]
    clip_id: String,
    #[serde(rename = "uploadUrl")]
    upload_url: String,
    #[serde(rename = "cdnUrl")]
    cdn_url: String,
    #[serde(rename = "watchUrl")]
    watch_url: String,
}

/// Resultado devuelto al frontend tras completar la subida.
#[derive(Debug, Serialize, Deserialize)]
pub struct ClipUploadResult {
    #[serde(rename = "clipId")]
    pub clip_id: String,
    #[serde(rename = "watchUrl")]
    pub watch_url: String,
    #[serde(rename = "cdnUrl")]
    pub cdn_url: String,
}

/// Representación DTO de un clip para el frontend.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClipItemDto {
    #[serde(rename = "clipId")]
    pub clip_id: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "gameId")]
    pub game_id: String,
    pub filename: String,
    #[serde(rename = "contentType")]
    pub content_type: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "cdnUrl")]
    pub cdn_url: String,
    #[serde(rename = "watchUrl")]
    pub watch_url: String,
    #[serde(rename = "posterUrl", skip_serializing_if = "Option::is_none")]
    pub poster_url: Option<String>,
    #[serde(rename = "steamAppId", skip_serializing_if = "Option::is_none")]
    pub steam_app_id: Option<String>,
    #[serde(rename = "gameTitle", skip_serializing_if = "Option::is_none")]
    pub game_title: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ListClipsApiResponse {
    clips: Vec<ClipItemDto>,
}

/// Determina el tipo MIME del archivo a partir de su extensión.
fn detect_content_type(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|s| s.to_lowercase())
        .as_deref()
    {
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        Some("mp4") | _ => "video/mp4",
    }
}

/// Sube un clip de juego a la nube mediante streaming directo y reporta el progreso en la barra global.
///
/// # Arguments
/// * `app` - Handle de la aplicación Tauri para emitir eventos de progreso globales.
/// * `game_id` - Identificador único del juego.
/// * `file_path` - Ruta absoluta del archivo de vídeo en el sistema de archivos local.
/// * `thumbnail_base64` - Captura opcional en formato base64 JPEG para generar miniatura en CDN.
#[command]
pub async fn upload_game_clip(
    app: AppHandle,
    game_id: String,
    file_path: String,
    thumbnail_base64: Option<String>,
) -> Result<ClipUploadResult, String> {
    let path = Path::new(&file_path);
    if !path.exists() || !path.is_file() {
        return Err(format!(
            "El archivo especificado no existe o no es válido: {}",
            file_path
        ));
    }

    let file_metadata = tokio::fs::metadata(path)
        .await
        .map_err(|e| format!("No se pudieron leer los metadatos del archivo: {}", e))?;
    let file_size = file_metadata.len();

    if file_size == 0 {
        return Err("El archivo de video seleccionado está vacío.".to_string());
    }

    let filename = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Nombre de archivo no válido".to_string())?
        .to_string();

    let content_type = detect_content_type(path);

    // 1. Obtener contexto de API (usuario, clave, URL)
    let api_ctx = crate::commands::sync::context::resolve_api_context()?;
    let base_url = api_ctx.base_url;
    let api_key = api_ctx.api_key;
    let user_id = api_ctx.user_id;

    let cfg = crate::config::load_config();
    let found_game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id));

    let detected_steam_id: Option<String> =
        found_game.and_then(|g| g.steam_app_id.clone()).or_else(|| {
            if game_id.chars().all(|c| c.is_ascii_digit()) {
                Some(game_id.clone())
            } else if let Some(pos) = game_id.rfind('-') {
                let suffix = &game_id[pos + 1..];
                if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) {
                    Some(suffix.to_string())
                } else {
                    None
                }
            } else {
                None
            }
        });

    let detected_poster_url: Option<String> = found_game
        .and_then(|g| g.image_url.clone())
        .or_else(|| {
            detected_steam_id.as_ref().map(|id| {
                format!(
                    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/{}/header.jpg",
                    id
                )
            })
        });

    let endpoint = format!("{}/clips/upload-url", base_url.trim_end_matches('/'));

    let payload = ClipUploadRequest {
        game_id: &game_id,
        filename: &filename,
        content_type,
        poster_url: detected_poster_url.as_deref(),
        steam_app_id: detected_steam_id.as_deref(),
        game_title: None,
        thumbnail_base64: thumbnail_base64.as_deref(),
    };

    // 2. Solicitar URL presignada a la API
    let response = API_CLIENT
        .post(&endpoint)
        .header("x-api-key", api_key)
        .header("x-user-id", user_id)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Fallo de red al solicitar URL de subida: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let err_body = response.text().await.unwrap_or_default();
        return Err(format!("API Error ({}): {}", status, err_body));
    }

    let upload_info = response
        .json::<ClipUploadApiResponse>()
        .await
        .map_err(|e| format!("Error al decodificar respuesta de la API: {}", e))?;

    let operation_id = format!("clip-upload-{}", upload_info.clip_id);

    // Emitir progreso inicial
    emit_sync_upload_progress(
        &app,
        SyncProgressPayload {
            operation_id: Some(operation_id.clone()),
            status: Some("running".to_string()),
            game_id: game_id.clone(),
            filename: format!("Clip: {}", filename),
            loaded: 0,
            total: file_size,
            downloaded_bytes: Some(0),
            total_bytes: Some(file_size),
            can_pause: Some(false),
            can_cancel: Some(false),
            can_resume: Some(false),
            strategy: Some(SyncOperationStrategy::Streaming),
            state: Some(SyncOperationState::Running),
            reason_code: None,
        },
    );

    // 3. Crear stream con emisión periódica de progreso hacia la barra general
    let progress_stream = create_clip_progress_stream(
        path,
        file_size,
        app.clone(),
        game_id.clone(),
        filename.clone(),
        operation_id.clone(),
    )?;

    let body = reqwest::Body::wrap_stream(progress_stream);

    let s3_response = DATA_CLIENT
        .put(&upload_info.upload_url)
        .header(reqwest::header::CONTENT_TYPE, content_type)
        .header(reqwest::header::CONTENT_LENGTH, file_size)
        .body(body)
        .send()
        .await;

    match s3_response {
        Ok(res) if res.status().is_success() => {
            // Notificar finalización exitosa a la barra de progreso global
            emit_sync_terminal(
                &app,
                operation_id,
                "completed",
                "upload",
                Some(game_id),
                Some(SyncOperationState::Completed),
                None,
            );
            emit_sync_upload_done(&app);

            Ok(ClipUploadResult {
                clip_id: upload_info.clip_id,
                watch_url: upload_info.watch_url,
                cdn_url: upload_info.cdn_url,
            })
        }
        Ok(res) => {
            let status = res.status();
            emit_sync_terminal(
                &app,
                operation_id,
                "failed",
                "upload",
                Some(game_id),
                Some(SyncOperationState::Failed),
                Some("S3_UPLOAD_ERROR".to_string()),
            );
            emit_sync_upload_done(&app);
            Err(format!(
                "Fallo al transferir video a S3 (Código HTTP {})",
                status
            ))
        }
        Err(e) => {
            emit_sync_terminal(
                &app,
                operation_id,
                "failed",
                "upload",
                Some(game_id),
                Some(SyncOperationState::Failed),
                Some("NETWORK_ERROR".to_string()),
            );
            emit_sync_upload_done(&app);
            Err(format!("Error de red al transferir video a S3: {}", e))
        }
    }
}

/// Consulta la lista de clips pertenecientes al usuario actual (opcionalmente filtrados por juego).
#[command]
pub async fn list_game_clips(game_id: Option<String>) -> Result<Vec<ClipItemDto>, String> {
    let api_ctx = crate::commands::sync::context::resolve_api_context()?;
    let base_url = api_ctx.base_url;
    let api_key = api_ctx.api_key;
    let user_id = api_ctx.user_id;

    let mut endpoint = format!("{}/clips", base_url.trim_end_matches('/'));
    if let Some(ref gid) = game_id {
        if !gid.trim().is_empty() {
            endpoint = format!("{}?gameId={}", endpoint, urlencoding::encode(gid.trim()));
        }
    }

    let response = API_CLIENT
        .get(&endpoint)
        .header("x-api-key", api_key)
        .header("x-user-id", user_id)
        .send()
        .await
        .map_err(|e| format!("Fallo de red al listar clips: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let err_body = response.text().await.unwrap_or_default();
        return Err(format!("API Error ({}): {}", status, err_body));
    }

    let result = response
        .json::<ListClipsApiResponse>()
        .await
        .map_err(|e| format!("Error al decodificar lista de clips: {}", e))?;

    Ok(result.clips)
}

/// Elimina un clip específico de la nube.
#[command]
pub async fn delete_game_clip(clip_id: String) -> Result<(), String> {
    if clip_id.trim().is_empty() {
        return Err("clip_id es requerido".to_string());
    }

    let api_ctx = crate::commands::sync::context::resolve_api_context()?;
    let base_url = api_ctx.base_url;
    let api_key = api_ctx.api_key;
    let user_id = api_ctx.user_id;

    let endpoint = format!(
        "{}/clips/{}",
        base_url.trim_end_matches('/'),
        urlencoding::encode(clip_id.trim())
    );

    let response = API_CLIENT
        .delete(&endpoint)
        .header("x-api-key", api_key)
        .header("x-user-id", user_id)
        .send()
        .await
        .map_err(|e| format!("Fallo de red al eliminar clip: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let err_body = response.text().await.unwrap_or_default();
        return Err(format!("API Error ({}): {}", status, err_body));
    }

    Ok(())
}
