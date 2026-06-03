//! Cliente de red centralizado para SaveCloud.
//!
//! Gestiona el ciclo de vida de las conexiones HTTP mediante pools persistentes
//! configurados por caso de uso. Hay tres clientes con perfiles distintos:
//!
//! - [`API_CLIENT`]: llamadas cortas de metadatos (JSON, presigned URLs, init/complete).
//! - [`DATA_CLIENT`]: transferencias binarias pesadas hacia S3 (PUT de partes multipart).
//! - [`STEAM_CLIENT`]: scraping de la API pública de Steam con User-Agent de navegador.
//! - [`HOSTER_DOWNLOAD_CLIENT`]: resolución y descarga de hosters (cookie jar compartido).
//!
//! # Por qué tres clientes separados
//!
//! `reqwest::Client` comparte el pool de conexiones entre todas las peticiones que
//! se hacen a través de él. Mezclar peticiones de metadatos (decenas de llamadas
//! cortas por segundo) con PUT de partes de 64 MB en el mismo pool hace que los
//! slots del pool se agoten durante los PUT, bloqueando las llamadas de control.
//! Separar los clientes garantiza que cada tipo de tráfico tenga sus propias
//! conexiones y no compita con los demás.
//!
//! # Cold start y TCP slow start
//!
//! La primera subida de cada sesión es más lenta por dos razones acumuladas:
//!
//! 1. **TLS handshake**: cada conexión nueva paga 1-2 RTTs antes del primer byte.
//!    `pool_max_idle_per_host` y `pool_idle_timeout` controlan cuántas conexiones
//!    ya negociadas se reutilizan entre partes consecutivas.
//!
//! 2. **TCP slow start**: el kernel arranca la ventana de congestión en ~10 segmentos
//!    (~14 KB) y la dobla cada RTT. Con partes de 8-64 MB el slow start dura varios
//!    segundos. `tcp_nodelay` no elimina el slow start pero sí evita que Nagle
//!    introduzca retardos adicionales en los ACK pequeños de S3.
//!
//! La única forma de eliminar completamente el cold start es mantener conexiones
//! vivas entre subidas, que es exactamente lo que hace `pool_idle_timeout` con
//! un valor más largo que el intervalo típico entre subidas consecutivas.

use std::sync::LazyLock;
use std::time::Duration;

pub mod hoster_download;
pub mod stream_download;

pub use hoster_download::{
    ensure_download_success, ensure_resolve_success, get, get_with_profile, head_no_redirect,
    head_short, head_with_client, post_form_urlencoded, post_json, post_multipart, DownloadProfile,
    HttpStatusError, ProfilePreset, RequestPhase, HOSTER_BROWSER_USER_AGENT,
    HOSTER_DOWNLOAD_CLIENT,
};

/// Identificador de agente de usuario para todas las peticiones de la aplicación.
const USER_AGENT: &str = "SaveCloud-desktop/1.0";

/// Número máximo de conexiones idle que el pool mantiene abiertas por host.
///
/// Para `DATA_CLIENT` el host de destino es siempre el mismo bucket S3, así que
/// este valor determina directamente cuántos PUT concurrentes pueden reutilizar
/// una conexión ya negociada en vez de abrir una nueva y pagar el TLS handshake.
///
/// Se alinea con `MAX_CONCURRENT_PARTS` de `upload_strategy` (16) más un margen
/// para las llamadas de control (init, part-urls, complete) que también usan
/// conexiones hacia el mismo host en algunos despliegues.
const DATA_POOL_MAX_IDLE_PER_HOST: usize = 20;

/// Tiempo máximo que una conexión idle permanece en el pool antes de cerrarse.
///
/// S3 cierra conexiones idle desde su lado aproximadamente a los 20 segundos.
/// Usar un valor superior hace que el cliente intente reutilizar una conexión
/// que S3 ya cerró, resultando en un error de reset que reqwest reintenta
/// abriendo una conexión nueva, añadiendo una RTT extra de latencia.
///
/// 15 segundos es conservador: queda por debajo del timeout de S3 con margen
/// suficiente para absorber variaciones de red, y es más largo que el intervalo
/// típico entre partes consecutivas de una subida activa.
const DATA_POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(15);

/// Intervalo de keepalive TCP para `DATA_CLIENT`.
///
/// Mantiene el túnel TCP vivo durante las ventanas de silencio que ocurren
/// mientras el encoder TAR llena el buffer de la parte siguiente. Sin keepalive,
/// los middleboxes (NAT, firewalls) pueden cerrar la conexión tras 30-60 segundos
/// de inactividad, causando un error de reset al intentar escribir la parte siguiente.
///
/// 10 segundos garantiza que se envía al menos un probe TCP antes de que cualquier
/// middleBox razonable cierre la conexión por inactividad.
const DATA_TCP_KEEPALIVE: Duration = Duration::from_secs(10);

/// Tiempo máximo total permitido para una sola parte de la subida multipart.
///
/// Con partes de hasta 128 MB y una conexión de 1 Mbps (caso extremo), la subida
/// tarda ~17 minutos. 20 minutos da margen suficiente sin bloquear indefinidamente
/// ante una conexión colgada.
const DATA_REQUEST_TIMEOUT: Duration = Duration::from_secs(1200);

/// Tiempo máximo para establecer la conexión TCP inicial.
///
/// 15 segundos cubre la mayoría de los casos de red lenta sin que el usuario
/// espere demasiado ante un host inalcanzable.
const DATA_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// Cliente HTTP optimizado para llamadas cortas de API y metadatos.
///
/// Usado para: init multipart, obtención de presigned URLs, complete, abort,
/// y cualquier otra llamada que intercambie JSON pequeño con el backend.
///
/// `tcp_nodelay` está activo porque los payloads JSON son pequeños y el
/// algoritmo de Nagle introduciría retardos innecesarios esperando acumular
/// más datos antes de enviar el segmento TCP.
pub static API_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .tcp_nodelay(true)
        .build()
        .expect("fallo critico al inicializar API_CLIENT")
});

/// Cliente HTTP de alto rendimiento para transferencias binarias hacia S3.
///
/// Usado exclusivamente para los PUT de partes en subidas multipart. Está
/// configurado para minimizar el cold start de TLS y TCP en subidas consecutivas
/// mediante un pool de conexiones idle calibrado para el comportamiento de S3.
///
/// # Decisiones de configuración
///
/// `pool_max_idle_per_host(20)`: S3 siempre es el mismo host por subida.
/// Mantener 20 conexiones idle cubre la concurrencia máxima de 16 partes
/// más las llamadas de control, eliminando el TLS handshake de todas las
/// partes excepto las primeras de cada sesión.
///
/// `pool_idle_timeout(15s)`: S3 cierra conexiones idle a los ~20 segundos.
/// Usar 15 segundos evita reutilizar conexiones que S3 ya cerró.
///
/// `tcp_keepalive(10s)`: envía probes TCP durante los silencios entre partes,
/// evitando que NAT y firewalls cierren el túnel mientras el encoder TAR
/// prepara el siguiente buffer.
///
/// `tcp_nodelay(true)`: elimina la latencia de Nagle en los ACK de S3.
/// Aunque los PUT son bloques grandes, los ACK de respuesta son pequeños
/// y Nagle los retrasaría esperando más datos para acumular.
///
/// `connection_verbose(false)` es el default y se deja explícito en los
/// comentarios para recordar que no se activa logging de hyper en producción.
pub static DATA_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(DATA_REQUEST_TIMEOUT)
        .connect_timeout(DATA_CONNECT_TIMEOUT)
        .tcp_keepalive(DATA_TCP_KEEPALIVE)
        .tcp_nodelay(true)
        .pool_max_idle_per_host(DATA_POOL_MAX_IDLE_PER_HOST)
        .pool_idle_timeout(DATA_POOL_IDLE_TIMEOUT)
        .build()
        .expect("fallo critico al inicializar DATA_CLIENT")
});

/// Cliente HTTP para transferencias peer LAN (archivos grandes, timeouts largos).
pub static PEER_LAN_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(DATA_REQUEST_TIMEOUT)
        .connect_timeout(DATA_CONNECT_TIMEOUT)
        .tcp_keepalive(DATA_TCP_KEEPALIVE)
        .tcp_nodelay(true)
        .pool_max_idle_per_host(4)
        .pool_idle_timeout(Duration::from_secs(60))
        .build()
        .expect("fallo critico al inicializar PEER_LAN_CLIENT")
});

/// Cliente especializado para el scraping de la API pública de Steam.
///
/// Usa un User-Agent de navegador moderno para evitar bloqueos del WAF de Valve.
/// No comparte pool con los otros clientes porque el host de destino es distinto
/// y el patrón de uso (ráfagas cortas, luego silencio) no se beneficia de
/// mantener conexiones idle por períodos largos.
pub static STEAM_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(HOSTER_BROWSER_USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .expect("fallo critico al inicializar STEAM_CLIENT")
});
