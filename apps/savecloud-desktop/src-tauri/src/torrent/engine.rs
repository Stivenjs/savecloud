//! Motor de descargas torrent construido sobre [`librqbit`] y expuesto al
//! frontend de Tauri a través de un conjunto de comandos asíncronos.
//!
//! # Arquitectura
//!
//! [`TorrentEngine`] posee una única [`Session`] compartida (vía [`Arc`]) con
//! cada tarea en segundo plano que monitorea el progreso de las descargas.
//! Cada torrent activo se identifica por su info-hash en hexadecimal para que
//! el frontend pueda dirigir operaciones (pausa, reanudación, cancelación) sin
//! conocer el identificador numérico interno asignado por librqbit.
//!
//! Las actualizaciones de progreso se envían al frontend mediante eventos de
//! Tauri: una tarea [`tokio`] dedicada por torrent llama a
//! [`spawn_progress_monitor`] y emite [`TORRENT_PROGRESS_EVENT`] a intervalos
//! fijos hasta que el torrent finaliza o es eliminado.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use librqbit::api::TorrentIdOrHash;
use librqbit::{AddTorrent, AddTorrentOptions, Session, SessionOptions, TorrentStatsState};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use super::errors::TorrentError;
use super::models::{TorrentDownloadState, TorrentProgressPayload};

/// Evento emitido periódicamente mientras un torrent está activo.
///
/// El payload es de tipo [`TorrentProgressPayload`] y contiene métricas de
/// velocidad, progreso, ETA y estado actual del torrent.
const TORRENT_PROGRESS_EVENT: &str = "torrent-download-progress";

/// Evento emitido una sola vez cuando el torrent alcanza el 100 % y librqbit
/// lo marca como finalizado.
///
/// El frontend debe usar este evento como señal autoritativa de finalización en
/// lugar de inspeccionar `progress_percent`, ya que el tick final de progreso y
/// el flag `finished` son observados de forma conjunta antes de emitirlo.
const TORRENT_DONE_EVENT: &str = "torrent-download-done";

/// Evento emitido cuando el usuario cancela un torrent y éste es eliminado de
/// la sesión.
///
/// El frontend debe ocultar cualquier UI de progreso al recibir este evento.
/// Dado que puede existir un tick de progreso en vuelo en el momento de la
/// cancelación, este evento actúa como señal definitiva que anula cualquier
/// payload obsoleto que llegue concurrentemente.
pub const TORRENT_CANCELLED_EVENT: &str = "torrent-download-cancelled";

/// Intervalo entre muestreos de estadísticas y emisiones de progreso al frontend.
///
/// 800 ms es un compromiso deliberado: suficientemente corto para que la
/// velocidad y el ETA se perciban responsivos en la UI, y suficientemente largo
/// para no presionar el read-lock interno de la sesión en hardware de gama baja.
const PROGRESS_INTERVAL: std::time::Duration = std::time::Duration::from_millis(800);

/// Rango de puertos TCP en los que la sesión escucha conexiones entrantes de peers.
///
/// Un rango más amplio (69 puertos frente a los 19 originales) reduce la
/// probabilidad de que todos los candidatos estén ocupados por otra aplicación
/// o bloqueados por una regla de firewall. El rango comienza en el puerto
/// asignado por la IANA para BitTorrent (6881) y es lo suficientemente grande
/// como para sobrevivir a la mayoría de perfiles de firewall predeterminados
/// sin requerir configuración manual de reenvío de puertos.
const LISTEN_PORT_RANGE: std::ops::Range<u16> = 6881..6950;

/// Estado global del subsistema de descargas torrent.
///
/// Existe exactamente una instancia de `TorrentEngine` por proceso, almacenada
/// detrás de un `Mutex` en el estado gestionado de Tauri. Todos los métodos
/// públicos de este tipo son invocados desde comandos Tauri y deben ser `Send`.
pub struct TorrentEngine {
    /// La sesión de librqbit que gestiona todos los torrents activos.
    session: Arc<Session>,
    /// Info-hashes de torrents que han sido añadidos y aún no han completado
    /// ni sido cancelados. Permite detectar adiciones duplicadas y realizar
    /// operaciones masivas como pausar todo al suspender la aplicación.
    active: HashSet<String>,
}

impl TorrentEngine {
    /// Crea un nuevo motor e inicializa la sesión subyacente de librqbit.
    ///
    /// La sesión se configura para maximizar la accesibilidad a peers:
    ///
    /// - Un rango de puertos amplio aumenta la probabilidad de que al menos
    ///   uno sea alcanzable desde internet sin reenvío manual.
    /// - UPnP/NAT-PMP permite al router abrir el puerto elegido
    ///   automáticamente en redes que lo soporten, habilitando conexiones
    ///   entrantes no solicitadas.
    /// - DHT inicializa el descubrimiento de peers de forma independiente a
    ///   cualquier tracker, algo crítico cuando el tracker embebido en un
    ///   archivo `.torrent` está offline o aplicando rate-limiting.
    /// - `concurrent_init_limit` se mantiene en 3 para evitar que múltiples
    ///   torrents compitan por ancho de banda durante su fase de handshake,
    ///   que es cuando los slots de peer y el establecimiento de conexión
    ///   dominan el rendimiento.
    pub async fn new(output_folder: PathBuf) -> Result<Self, TorrentError> {
        let options = SessionOptions {
            listen_port_range: Some(LISTEN_PORT_RANGE),
            enable_upnp_port_forwarding: true,
            fastresume: true,
            concurrent_init_limit: Some(3),
            ..Default::default()
        };

        let session = Session::new_with_opts(output_folder, options)
            .await
            .map_err(|e| TorrentError::SessionInit(e.to_string()))?;

        Ok(Self {
            session,
            active: HashSet::new(),
        })
    }

    /// Devuelve un clon del handle de sesión envuelto en [`Arc`].
    ///
    /// Los llamadores que necesiten realizar operaciones de sesión desde una
    /// tarea en segundo plano deben clonar el `Arc` aquí en lugar de mantener
    /// un borrow sobre `TorrentEngine`, que vive detrás de un `Mutex`.
    pub fn session(&self) -> Arc<Session> {
        self.session.clone()
    }

    /// Registra `info_hash` como descarga activa.
    ///
    /// Debe llamarse inmediatamente después de que un torrent se haya añadido
    /// con éxito a la sesión. El hash es usado por [`unregister_active`] y por
    /// cualquier operación masiva futura que necesite enumerar las descargas en
    /// curso.
    pub fn register_active(&mut self, info_hash: String) {
        self.active.insert(info_hash);
    }

    /// Elimina `info_hash` del conjunto de descargas activas.
    ///
    /// Debe llamarse cuando un torrent completa, es cancelado o encuentra un
    /// error fatal. Llamar a este método con un hash desconocido es una
    /// operación sin efecto.
    pub fn unregister_active(&mut self, info_hash: &str) {
        self.active.remove(info_hash);
    }

    pub fn active_hashes(&self) -> Vec<String> {
        self.active.iter().cloned().collect()
    }
}

/// Parsea un info-hash en hexadecimal a un [`TorrentIdOrHash`].
///
/// Devuelve [`TorrentError::NotFound`] si la cadena no es un digest SHA-1 o
/// SHA-256 hexadecimal válido de 40 o 64 caracteres respectivamente.
fn parse_info_hash(info_hash: &str) -> Result<TorrentIdOrHash, TorrentError> {
    TorrentIdOrHash::try_from(info_hash)
        .map_err(|_| TorrentError::NotFound(format!("info_hash inválido: {info_hash}")))
}

/// Convierte una velocidad expresada en megabits por segundo a bytes por segundo.
///
/// librqbit expone las velocidades a través de un campo llamado `mbps` cuya
/// unidad son **megabits por segundo** (Mbps), no megabytes. La conversión es:
///
/// ```text
/// bytes/s = Mbps × 1_000_000 ÷ 8  =  Mbps × 125_000
/// ```
///
/// Casos límite manejados explícitamente:
/// - `NaN` y valores negativos producen `0` en lugar de un entero sin sentido
///   tras el cast `as u64`.
/// - Valores que desborden `u64` se limitan a `u64::MAX`. En la práctica este
///   umbral (~147 Pbps) es inalcanzable, pero el clamp previene comportamiento
///   indefinido si librqbit emitiera una medición corrupta.
#[inline]
fn mbps_to_bytes_per_sec(mbps: f64) -> u64 {
    if mbps <= 0.0 || mbps.is_nan() {
        return 0;
    }
    (mbps * 125_000.0).min(u64::MAX as f64) as u64
}

/// Estima el tiempo restante para completar una descarga, en segundos.
///
/// Devuelve `None` cuando la descarga ya está completa (`downloaded >= total`)
/// o cuando no hay medición de velocidad disponible (`speed_bytes == 0`),
/// ya que dividir entre cero o reportar un ETA infinito sería engañoso.
///
/// La división se redondea **hacia arriba** para que el ETA mostrado nunca
/// caiga a cero mientras aún faltan bytes, un problema habitual cuando se usa
/// división entera truncada con archivos pequeños o velocidades altas.
#[inline]
fn compute_eta(total: u64, downloaded: u64, speed_bytes: u64) -> Option<u64> {
    if speed_bytes == 0 || downloaded >= total {
        return None;
    }
    let remaining = total - downloaded;
    Some(remaining.saturating_add(speed_bytes - 1) / speed_bytes)
}

/// Emite un evento `torrent-download-progress` inicial con métricas en cero.
///
/// Llamar a esta función inmediatamente después de añadir un torrent garantiza
/// que el frontend transite al estado visual "iniciando" antes de que llegue el
/// primer tick de progreso real, que puede tardar varios segundos mientras
/// librqbit resuelve los peers iniciales.
pub fn emit_starting_event(app: &AppHandle, info_hash: &str, name: &str) {
    let payload = TorrentProgressPayload {
        info_hash: info_hash.to_string(),
        name: name.to_string(),
        progress_percent: 0.0,
        download_speed_bytes: 0,
        upload_speed_bytes: 0,
        state: TorrentDownloadState::Starting,
        total_bytes: 0,
        downloaded_bytes: 0,
        eta_seconds: None,
        peers_connected: 0,
    };
    let _ = app.emit(TORRENT_PROGRESS_EVENT, &payload);
}

/// Elimina un torrent de la sesión sin borrar los archivos descargados.
///
/// El segundo argumento de [`Session::delete`] controla el borrado de archivos;
/// pasar `false` conserva lo que ya se haya escrito en disco, que corresponde
/// a la semántica habitual de "cancelar descarga" en clientes torrent.
pub async fn cancel_via_session(
    session: &Arc<Session>,
    info_hash: &str,
) -> Result<(), TorrentError> {
    let id = parse_info_hash(info_hash)?;
    let handle = session
        .get(id)
        .ok_or_else(|| TorrentError::NotFound(info_hash.to_string()))?;
    session
        .delete(TorrentIdOrHash::Id(handle.id()), false)
        .await
        .map_err(|e| TorrentError::Cancel(e.to_string()))
}

/// Suspende la actividad de I/O y peers del torrent indicado sin eliminarlo.
///
/// El torrent permanece en la sesión y sus metadatos se conservan, por lo que
/// [`resume_via_session`] puede reiniciarlo sin necesidad de añadirlo de nuevo.
pub async fn pause_via_session(
    session: &Arc<Session>,
    info_hash: &str,
) -> Result<(), TorrentError> {
    let id = parse_info_hash(info_hash)?;
    let handle = session
        .get(id)
        .ok_or_else(|| TorrentError::NotFound(info_hash.to_string()))?;
    session
        .pause(&handle)
        .await
        .map_err(|e| TorrentError::Pause(e.to_string()))
}

/// Reanuda un torrent previamente pausado.
///
/// librqbit reconectará a los peers y continuará desde el último estado de
/// fast-resume guardado, por lo que ninguna pieza ya en disco será
/// re-descargada.
pub async fn resume_via_session(
    session: &Arc<Session>,
    info_hash: &str,
) -> Result<(), TorrentError> {
    let id = parse_info_hash(info_hash)?;
    let handle = session
        .get(id)
        .ok_or_else(|| TorrentError::NotFound(info_hash.to_string()))?;
    session
        .unpause(&handle)
        .await
        .map_err(|e| TorrentError::Resume(e.to_string()))
}

/// Añade un magnet link a la sesión y devuelve su información de identidad.
///
/// La tupla devuelta es `(info_hash, nombre_visible, id_numérico)`.
/// `nombre_visible` se deriva del parámetro `dn=` del URI magnet cuando está
/// disponible; de lo contrario, se usa el info-hash en hexadecimal como
/// fallback.
///
/// En librqbit 8.1.x el número máximo de peers concurrentes por torrent lo fija
/// la propia biblioteca (semáforo interno); no hay campo equivalente a
/// `max_peers` en [`AddTorrentOptions`].
pub async fn add_magnet_to_session(
    session: &Arc<Session>,
    magnet_link: &str,
    save_path: &str,
) -> Result<(String, String, usize), TorrentError> {
    let add_options = AddTorrentOptions {
        output_folder: Some(save_path.into()),
        ..Default::default()
    };

    let response = session
        .add_torrent(AddTorrent::from_url(magnet_link), Some(add_options))
        .await
        .map_err(|e| TorrentError::AddMagnet(e.to_string()))?;

    let handle = response.into_handle().ok_or(TorrentError::ListOnly)?;
    let info_hash = handle.info_hash().as_string();
    let name = handle
        .name()
        .map(|s| s.to_string())
        .unwrap_or_else(|| info_hash.clone());
    let id = handle.id();

    Ok((info_hash, name, id))
}

/// Añade un archivo `.torrent` local a la sesión y devuelve su identidad.
///
/// La tupla devuelta es `(info_hash, nombre_visible, id_numérico)`.
///
/// `wait_until_initialized()` **no** se invoca intencionalmente. Ese método
/// bloquea hasta que librqbit sale del estado `Initializing`, lo que puede
/// tardar varios minutos con peers lentos o torrents grandes. Esperarlo dentro
/// de un comando Tauri bloquearía el hilo IPC completo. El frontend recibe
/// actualizaciones de estado incrementales a través de [`spawn_progress_monitor`]
/// y es responsable de renderizar el estado `Starting` de forma apropiada.
pub async fn add_file_to_session(
    session: &Arc<Session>,
    file_path: &str,
    save_path: &str,
) -> Result<(String, String, usize), TorrentError> {
    let add_options = AddTorrentOptions {
        output_folder: Some(save_path.into()),
        ..Default::default()
    };

    let add = AddTorrent::from_local_filename(file_path)
        .map_err(|e| TorrentError::ReadTorrentFile(e.to_string()))?;

    let response = session
        .add_torrent(add, Some(add_options))
        .await
        .map_err(|e| TorrentError::AddTorrent(e.to_string()))?;

    let handle = response.into_handle().ok_or(TorrentError::ListOnly)?;
    let info_hash = handle.info_hash().as_string();
    let name = handle
        .name()
        .map(|s| s.to_string())
        .unwrap_or_else(|| info_hash.clone());
    let id = handle.id();

    Ok((info_hash, name, id))
}

/// Lanza una tarea en segundo plano que emite eventos de progreso periódicamente.
///
/// La tarea itera a [`PROGRESS_INTERVAL`], muestrea las estadísticas del torrent
/// desde la sesión y emite un [`TORRENT_PROGRESS_EVENT`] al frontend de Tauri.
/// Cuando el torrent finaliza, emite adicionalmente [`TORRENT_DONE_EVENT`] y
/// abandona el bucle. Si el torrent es eliminado de la sesión mientras la tarea
/// está en ejecución (por ejemplo, a través de [`cancel_via_session`]), la única
/// llamada a `session.get()` en cada tick devuelve `None` y la tarea termina
/// limpiamente.
///
/// # Seguridad ante cancelación
///
/// Se usa deliberadamente una sola llamada a `session.get()` por tick. El patrón
/// original de dos llamadas (una para estadísticas, otra para verificar
/// eliminación) introducía una condición de carrera TOCTOU: el torrent podía ser
/// eliminado entre ambas llamadas, haciendo que se emitiera un evento de progreso
/// obsoleto tras la cancelación y que la barra de progreso reapareciera
/// momentáneamente. Con una sola llamada, ambas verificaciones se resuelven de
/// forma atómica.
pub fn spawn_progress_monitor(
    session: Arc<Session>,
    torrent_id: usize,
    info_hash: String,
    name: String,
    app: AppHandle,
    engine_state: Option<Arc<Mutex<TorrentEngine>>>,
) {
    tokio::spawn(async move {
        let id = TorrentIdOrHash::Id(torrent_id);
        let mut interval = tokio::time::interval(PROGRESS_INTERVAL);

        loop {
            interval.tick().await;

            // Un único lookup por tick garantiza que la presencia del torrent y
            // la lectura de sus estadísticas son consistentes entre sí.
            let managed = match session.get(id) {
                Some(m) => m,
                None => break,
            };

            let stats = managed.stats();

            // El snapshot `live` solo está presente mientras el torrent tiene
            // actividad de red. Si está ausente, todas las métricas de red se
            // reportan como cero para no mostrar valores desactualizados.
            let (download_speed_bytes, upload_speed_bytes, peers_connected) =
                if let Some(live) = &stats.live {
                    (
                        mbps_to_bytes_per_sec(live.download_speed.mbps),
                        mbps_to_bytes_per_sec(live.upload_speed.mbps),
                        live.snapshot.peer_stats.live as u32,
                    )
                } else {
                    (0, 0, 0)
                };

            let total_bytes = stats.total_bytes;
            let downloaded_bytes = stats.progress_bytes;

            // Se limita a 100.0 para absorber pequeñas imprecisiones de punto
            // flotante que podrían producir valores como 100.0000001.
            let progress_percent = if total_bytes > 0 {
                ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).min(100.0) as f32
            } else {
                0.0
            };

            let eta_seconds = compute_eta(total_bytes, downloaded_bytes, download_speed_bytes);

            // El flag `finished` tiene prioridad sobre `stats.state` porque
            // librqbit puede reportar un estado intermedio en el tick exacto en
            // que el último piece es verificado y escrito.
            let state = if stats.finished {
                TorrentDownloadState::Completed
            } else {
                match stats.state {
                    TorrentStatsState::Paused => TorrentDownloadState::Paused,
                    TorrentStatsState::Initializing => TorrentDownloadState::Starting,
                    _ => TorrentDownloadState::Downloading,
                }
            };

            let payload = TorrentProgressPayload {
                info_hash: info_hash.clone(),
                name: name.clone(),
                progress_percent,
                download_speed_bytes,
                upload_speed_bytes,
                state: state.clone(),
                total_bytes,
                downloaded_bytes,
                eta_seconds,
                peers_connected,
            };

            let _ = app.emit(TORRENT_PROGRESS_EVENT, &payload);

            if stats.finished {
                let _ = app.emit(TORRENT_DONE_EVENT, &payload);
                if let Some(engine) = &engine_state {
                    let mut eng = engine.lock().await;
                    eng.unregister_active(&info_hash);
                }
                break;
            }
        }
    });
}
