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
    host: Option<Arc<crate::streaming::host::SunshineHost>>,
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

pub fn generate_self_signed_cert() -> Result<(String, String), String> {
    let subject_alt_names = vec!["localhost".to_string(), "127.0.0.1".to_string()];
    let cert = rcgen::generate_simple_self_signed(subject_alt_names)
        .map_err(|e| format!("Fallo al generar cert: {e}"))?;

    let cert_pem = cert.serialize_pem().map_err(|e| e.to_string())?;
    let key_pem = cert.serialize_private_key_pem();

    Ok((cert_pem, key_pem))
}

pub async fn ensure_lan_http_server(
    host: Option<Arc<crate::streaming::host::SunshineHost>>,
) -> Result<u16, String> {
    if let Ok(guard) = LAN_RUNTIME.lock() {
        if let Some(runtime) = guard.as_ref() {
            if !runtime.handle.is_finished() {
                if let Ok(mut inner) = runtime.state.inner.write() {
                    inner.host = host;
                }
                return Ok(runtime.port);
            }
        }
    }

    let state = LanHttpState {
        inner: Arc::new(RwLock::new(LanServerInner {
            transfer: None,
            host,
        })),
    };

    let app = Router::new()
        .route("/files/{*file_path}", get(serve_file))
        .route("/health", get(|| async { "ok" }))
        .route(
            "/streaming/pair",
            axum::routing::post(handle_streaming_pair),
        )
        .layer(middleware::from_fn(auth_middleware))
        .with_state(state.clone());

    let (cert_pem, key_pem) = generate_self_signed_cert()?;
    let config = axum_server::tls_rustls::RustlsConfig::from_pem(
        cert_pem.into_bytes(),
        key_pem.into_bytes(),
    )
    .await
    .map_err(|e| format!("Error en config TLS: {e}"))?;

    let listener = std::net::TcpListener::bind("0.0.0.0:0")
        .map_err(|e| format!("No se pudo abrir puerto LAN: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let handle = tokio::spawn(async move {
        if let Err(e) = axum_server::from_tcp_rustls(listener, config)
            .serve(app.into_make_service())
            .await
        {
            log::warn!("Servidor LAN HTTPS finalizado: {e}");
        }
    });

    if let Ok(mut guard) = LAN_RUNTIME.lock() {
        *guard = Some(LanRuntime {
            port,
            handle,
            state,
        });
    }

    log::info!("Servidor LAN HTTPS escuchando en puerto {port}");
    Ok(port)
}

pub async fn start_lan_server_for_session(token: &str, game_key: &str) -> Result<u16, String> {
    let port = ensure_lan_http_server(None).await?;

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
        if let Some(ref root_str) = game.install_root {
            let root = PathBuf::from(root_str);
            if root.is_dir() {
                roots.insert(game_key.to_string(), root);
            }
        }
        if roots.is_empty() {
            let library = crate::config::load_library();
            for g in &library.games {
                if crate::peer_inventory::game_key_for_configured_game(g).as_deref()
                    == Some(game_key)
                {
                    if let Some(root) = resolve_install_root(g, game_key) {
                        roots.insert(game_key.to_string(), root);
                        break;
                    }
                }
            }
        }
    } else if game.payload_kind == "sourcesArchive" {
        if let Some(ref root_str) = game.install_root {
            let root = PathBuf::from(root_str);
            if root.is_dir() {
                roots.insert(game_key.to_string(), root);
            }
        }
        if roots.is_empty() {
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
    if request.uri().path() == "/health" || request.uri().path() == "/streaming/pair" {
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

    let transfer = transfer.ok_or_else(|| {
        log::warn!("LAN /files solicitado sin transferencia activa");
        StatusCode::NOT_FOUND
    })?;

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
        log::warn!(
            "LAN archivo no encontrado: rel={rel} root={} full={}",
            root.display(),
            full.display()
        );
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
#[derive(serde::Deserialize)]
struct StreamingPairRequest {
    client_cert: String,
    unique_id: String,
}

async fn handle_streaming_pair(
    State(http_state): State<LanHttpState>,
    axum::extract::Json(payload): axum::extract::Json<StreamingPairRequest>,
) -> Result<Response, StatusCode> {
    let data_dir = dirs::data_dir().unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    let state_path = data_dir
        .join("SaveCloud")
        .join("sunshine_bin")
        .join("Sunshine")
        .join("config")
        .join("sunshine_state.json");

    let mut state: serde_json::Value = if state_path.exists() {
        let data = std::fs::read_to_string(&state_path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if state.pointer("/root/uniqueid").is_none() {
        let server_id = uuid::Uuid::new_v4().to_string();
        if state.get("root").is_none() {
            state["root"] = serde_json::json!({});
        }
        state["root"]["uniqueid"] = serde_json::json!(server_id);
    }

    if state.pointer("/root/devices").is_none() {
        state["root"]["devices"] = serde_json::json!([]);
    }

    let devices = state
        .pointer_mut("/root/devices")
        .and_then(|v| v.as_array_mut())
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut found = false;
    let mut updated = false;
    for device in devices.iter_mut() {
        if device.get("uniqueid").and_then(|v| v.as_str()) == Some(&payload.unique_id) {
            found = true;
            let certs = device
                .get("certs")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            let cert_exists = certs
                .iter()
                .any(|c| c.as_str() == Some(&payload.client_cert));

            if !cert_exists {
                device["certs"] = serde_json::json!([payload.client_cert]);
                updated = true;
            }
            break;
        }
    }

    let mut added = false;
    if !found {
        let devices = state
            .pointer_mut("/root/devices")
            .and_then(|v| v.as_array_mut())
            .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

        devices.push(serde_json::json!({
            "uniqueid": payload.unique_id,
            "certs": [payload.client_cert]
        }));
        added = true;
    }

    if added || updated {
        if let Some(parent) = state_path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            }
        }

        let new_json =
            serde_json::to_string_pretty(&state).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        std::fs::write(&state_path, &new_json).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        log::info!(
            "sunshine_state.json actualizado con formato root.devices[].certs[] para client {}",
            payload.unique_id
        );

        let host_to_restart = {
            if let Ok(inner) = http_state.inner.read() {
                inner.host.clone()
            } else {
                None
            }
        };

        if let Some(host) = host_to_restart {
            log::info!("Reiniciando Sunshine para aplicar el nuevo cliente emparejado...");
            let _ = host.stop().await;
            let _ = host.start().await;
            tokio::time::sleep(std::time::Duration::from_millis(3000)).await;
        }

        log::info!(
            "Cliente {} autorizado dinámicamente en sunshine_state.json",
            payload.unique_id
        );
    }

    Ok((StatusCode::OK, "Paired").into_response())
}
