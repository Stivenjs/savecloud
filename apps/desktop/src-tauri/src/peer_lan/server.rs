//! Servidor HTTP LAN unificado: presencia (`/health`) + archivos (`/files/*`).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use axum::{
    extract::{Path as AxumPath, Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use once_cell::sync::Lazy;
use tokio::fs::File;
use tokio::io::AsyncSeekExt;
use tokio_util::io::ReaderStream;

use crate::peer_inventory::{load_local_manifest, resolve_install_root};
use crate::peer_lan::session::peek_valid_session;

const CHUNK_SIZE: usize = 512 * 1024;

#[derive(Clone)]
struct TransferServeState {
    token: String,
    root_paths: Arc<HashMap<String, PathBuf>>,
    cancel: Arc<AtomicBool>,
}

#[derive(Default)]
struct LanServerInner {
    transfer: Option<TransferServeState>,
}

#[derive(Clone)]
struct LanHttpState {
    inner: Arc<RwLock<LanServerInner>>,
}

struct LanRuntime {
    port: u16,
    handle: tokio::task::JoinHandle<()>,
    state: LanHttpState,
}

static LAN_RUNTIME: Lazy<Mutex<Option<LanRuntime>>> = Lazy::new(|| Mutex::new(None));

pub async fn ensure_lan_http_server() -> Result<u16, String> {
    if let Ok(guard) = LAN_RUNTIME.lock() {
        if let Some(runtime) = guard.as_ref() {
            if !runtime.handle.is_finished() {
                return Ok(runtime.port);
            }
        }
    }

    let state = LanHttpState {
        inner: Arc::new(RwLock::new(LanServerInner::default())),
    };

    let app = Router::new()
        .route("/files/{*file_path}", get(serve_file))
        .route("/health", get(|| async { "ok" }))
        .layer(middleware::from_fn(auth_middleware))
        .with_state(state.clone());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("No se pudo abrir puerto LAN: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let handle = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            log::warn!("Servidor LAN finalizado: {e}");
        }
    });

    if let Ok(mut guard) = LAN_RUNTIME.lock() {
        *guard = Some(LanRuntime {
            port,
            handle,
            state,
        });
    }

    log::info!("Servidor LAN escuchando en puerto {port}");
    Ok(port)
}

/// Activa el modo transferencia sobre el servidor persistente (sin abrir puertos nuevos).
pub async fn start_lan_server_for_session(token: &str, game_key: &str) -> Result<u16, String> {
    let port = ensure_lan_http_server().await?;

    if let Ok(guard) = LAN_RUNTIME.lock() {
        if let Some(runtime) = guard.as_ref() {
            if let Ok(inner) = runtime.state.inner.read() {
                if inner.transfer.as_ref().is_some_and(|t| t.token == token) {
                    return Ok(port);
                }
            }
        }
    }

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

    let mut roots = HashMap::new();
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

    let runtime = LAN_RUNTIME
        .lock()
        .map_err(|e| format!("LAN runtime lock: {e}"))?
        .as_ref()
        .ok_or_else(|| "Servidor LAN no iniciado".to_string())?
        .state
        .clone();

    let mut inner = runtime
        .inner
        .write()
        .map_err(|e| format!("LAN state lock: {e}"))?;
    inner.transfer = Some(TransferServeState {
        token: token.to_string(),
        root_paths: Arc::new(roots),
        cancel: Arc::new(AtomicBool::new(false)),
    });

    log::info!("Transferencia LAN activa en puerto {port} (gameKey={game_key})");
    Ok(port)
}

pub async fn stop_lan_server() {
    clear_transfer_state();
}

pub async fn shutdown_lan_http_server() {
    clear_transfer_state();
    if let Ok(mut guard) = LAN_RUNTIME.lock() {
        if let Some(runtime) = guard.take() {
            runtime.handle.abort();
            log::info!("Servidor LAN detenido (puerto {})", runtime.port);
        }
    }
}

fn clear_transfer_state() {
    if let Ok(guard) = LAN_RUNTIME.lock() {
        if let Some(runtime) = guard.as_ref() {
            if let Ok(mut inner) = runtime.state.inner.write() {
                inner.transfer = None;
            }
        }
    }
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
    State(state): State<LanHttpState>,
    AxumPath(file_path): AxumPath<String>,
) -> Result<Response, StatusCode> {
    let transfer = {
        let inner = state
            .inner
            .read()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        inner.transfer.clone()
    };

    let transfer = transfer.ok_or(StatusCode::NOT_FOUND)?;

    if transfer.cancel.load(Ordering::Relaxed) {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    let rel = urlencoding::decode(&file_path.replace('\\', "/"))
        .map(|c| c.into_owned())
        .unwrap_or_else(|_| file_path.replace('\\', "/"));
    if rel.contains("..") {
        return Err(StatusCode::BAD_REQUEST);
    }

    let (_game_key, root) = transfer
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
