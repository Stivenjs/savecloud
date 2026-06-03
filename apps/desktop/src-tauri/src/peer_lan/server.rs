//! Servidor HTTP LAN para servir archivos del inventario local.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use axum::{
    extract::{Path as AxumPath, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use tokio::fs::File;
use tokio::io::AsyncSeekExt;
use tokio_util::io::ReaderStream;

use crate::peer_inventory::{load_local_manifest, resolve_install_root};
use crate::peer_lan::session::peek_valid_session;

const CHUNK_SIZE: usize = 512 * 1024;

#[derive(Clone)]
struct LanServerState {
    root_paths: Arc<std::collections::HashMap<String, PathBuf>>,
    cancel: Arc<AtomicBool>,
}

static ACTIVE_SERVER: once_cell::sync::Lazy<std::sync::Mutex<Option<tokio::task::JoinHandle<()>>>> =
    once_cell::sync::Lazy::new(|| std::sync::Mutex::new(None));

pub async fn stop_lan_server() {
    if let Ok(mut guard) = ACTIVE_SERVER.lock() {
        if let Some(handle) = guard.take() {
            handle.abort();
        }
    }
}

pub async fn start_lan_server_for_session(token: &str, game_key: &str) -> Result<u16, String> {
    stop_lan_server().await;

    let session = peek_valid_session(token)
        .ok_or_else(|| "Sesión de transferencia inválida o expirada".to_string())?;
    if session.game_key != game_key {
        return Err("gameKey no coincide con la sesión".to_string());
    }

    let manifest = load_local_manifest()?.ok_or_else(|| "Sin manifiesto local".to_string())?;
    let game = manifest
        .games
        .iter()
        .find(|g| g.game_key == game_key)
        .ok_or_else(|| "Juego no encontrado en inventario local".to_string())?;

    if game.manifest_hash != session.manifest_hash {
        return Err("manifestHash no coincide".to_string());
    }

    let mut roots = std::collections::HashMap::new();
    if game.payload_kind == "installedFolder" {
        let library = crate::config::load_library();
        for g in &library.games {
            if crate::peer_inventory::game_key_for_configured_game(g).as_deref() == Some(game_key) {
                if let Some(root) = resolve_install_root(g, game_key) {
                    roots.insert(game_key.to_string(), root);
                    break;
                }
            }
        }
    } else if game.payload_kind == "sourcesArchive" {
        if let Some(ref archive) = game.sources_archive {
            let jobs = crate::sources::store::load_jobs().unwrap_or_default();
            if let Some(job) = jobs.iter().find(|j| j.job_id == archive.job_id) {
                let root = PathBuf::from(&job.destination_dir);
                if root.is_dir() {
                    roots.insert(game_key.to_string(), root);
                }
            }
        }
    }

    if roots.is_empty() {
        return Err("No se encontró ruta local para servir el juego".to_string());
    }

    let cancel = Arc::new(AtomicBool::new(false));
    let state = LanServerState {
        root_paths: Arc::new(roots),
        cancel: cancel.clone(),
    };

    let app = Router::new()
        .route("/files/{*file_path}", get(serve_file))
        .route("/health", get(|| async { "ok" }))
        .layer(middleware::from_fn(auth_middleware))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("No se pudo abrir puerto LAN: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    register_mdns_service(&manifest.device_id, &manifest.user_id, port)?;

    let handle = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            log::warn!("Servidor LAN finalizado: {e}");
        }
    });

    if let Ok(mut guard) = ACTIVE_SERVER.lock() {
        *guard = Some(handle);
    }

    Ok(port)
}

fn register_mdns_service(device_id: &str, user_id: &str, port: u16) -> Result<(), String> {
    let service = mdns_sd::ServiceDaemon::new().map_err(|e| format!("mDNS: {e}"))?;
    let host = gethostname::gethostname().to_string_lossy().into_owned();
    let instance = format!("savecloud-{device_id}");
    let mut properties = std::collections::HashMap::new();
    properties.insert("deviceId".to_string(), device_id.to_string());
    properties.insert("userId".to_string(), user_id.to_string());

    let info = mdns_sd::ServiceInfo::new(
        "_savecloud._tcp.local.",
        &instance,
        &format!("{host}.local."),
        "",
        port,
        properties,
    )
    .map_err(|e| format!("mDNS ServiceInfo: {e}"))?;

    service
        .register(info)
        .map_err(|e| format!("mDNS register: {e}"))?;
    Ok(())
}

async fn auth_middleware(request: Request, next: Next) -> Result<Response, StatusCode> {
    if request.uri().path() == "/health" {
        return Ok(next.run(request).await);
    }
    let auth = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let token = auth.strip_prefix("Bearer ").unwrap_or("");
    if peek_valid_session(token).is_some() {
        Ok(next.run(request).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

async fn serve_file(
    State(state): State<LanServerState>,
    AxumPath(file_path): AxumPath<String>,
) -> Result<Response, StatusCode> {
    if state.cancel.load(Ordering::Relaxed) {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    let rel = file_path.replace('\\', "/");
    if rel.contains("..") {
        return Err(StatusCode::BAD_REQUEST);
    }

    let (_game_key, root) = state
        .root_paths
        .iter()
        .next()
        .ok_or(StatusCode::NOT_FOUND)?;

    let full = root.join(&rel);
    if !full.is_file() {
        return Err(StatusCode::NOT_FOUND);
    }

    let mut file = File::open(&full).await.map_err(|_| StatusCode::NOT_FOUND)?;
    let len = file
        .metadata()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .len();
    file.seek(std::io::SeekFrom::Start(0))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let stream = ReaderStream::with_capacity(file, CHUNK_SIZE);
    let body = axum::body::Body::from_stream(stream);
    let len_header = len.to_string();

    Ok((
        [
            (header::CONTENT_TYPE, "application/octet-stream"),
            (header::CONTENT_LENGTH, len_header.as_str()),
        ],
        body,
    )
        .into_response())
}
