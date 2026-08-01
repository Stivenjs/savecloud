//! Gestor de estado en memoria y cola cold-start para el WebSocket de SaveCloud.
//!
//! Este módulo proporciona la estructura [`CloudWsState`] que Tauri utiliza para
//! administrar el hilo de red en segundo plano, gestionar el ciclo de vida de la conexión
//! y permitir el envío asíncrono de mensajes salientes (con buffer automático de cold-start).
//!
//! ## Cold-Start Buffer
//! Si la interfaz de usuario envía un evento de presencia antes de que el *handshake* WebSocket
//! finalice, el mensaje se almacena temporalmente en `pending_queue`. Una vez establecida la conexión,
//! la señal `ready_notify` drena automáticamente la cola en el orden exacto sin pérdida de eventos.

use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::task::JoinHandle;

use super::ws_client::{
    start_ws_loop, CloudBroadcastPayload, CloudOutgoingMessage, CloudStreamSignalPayload,
    WsRuntimeMetrics,
};
use crate::plugins::log_buffer::AppLogs;

/// Estado compartido del WebSocket de la nube gestionado por Tauri.
pub struct CloudWsState {
    /// Sender para canalizar mensajes salientes hacia el bucle de red en segundo plano.
    /// Contiene `None` cuando el WebSocket está detenido o en reinicio.
    pub tx: Arc<Mutex<Option<mpsc::UnboundedSender<CloudOutgoingMessage>>>>,

    /// Handle de la tarea de Tokio encargada del bucle de red.
    pub handle: Arc<Mutex<Option<JoinHandle<()>>>>,

    /// Cola de mensajes almacenados durante el arranque en frío (cold-start).
    /// Se drena automáticamente en cuanto se confirma la conexión.
    pending_queue: Arc<Mutex<Vec<CloudOutgoingMessage>>>,

    /// Métricas de tiempo de ejecución acumuladas para observabilidad y diagnósticos de salud.
    pub ws_metrics: Arc<Mutex<WsRuntimeMetrics>>,
}

impl Default for CloudWsState {
    fn default() -> Self {
        Self::new()
    }
}

impl CloudWsState {
    /// Crea una nueva instancia limpia del gestor de estado WebSocket.
    #[must_use]
    pub fn new() -> Self {
        Self {
            tx: Arc::new(Mutex::new(None)),
            handle: Arc::new(Mutex::new(None)),
            pending_queue: Arc::new(Mutex::new(Vec::new())),
            ws_metrics: Arc::new(Mutex::new(WsRuntimeMetrics::default())),
        }
    }

    /// Obtiene una captura instantánea de las métricas de runtime y el tamaño de la cola de espera.
    ///
    /// # Retorna
    /// Tupla con la copia de [`WsRuntimeMetrics`] y el número de mensajes pendientes en cola.
    pub async fn observability_ws_snapshot(&self) -> (WsRuntimeMetrics, usize) {
        let m = self.ws_metrics.lock().await.clone();
        let pending = self.pending_queue.lock().await.len();
        (m, pending)
    }

    /// Inicia la conexión WebSocket en un hilo de fondo.
    /// Si existe una conexión previamente activa, la aborta de forma segura antes de conectar.
    ///
    /// # Argumentos
    /// * `app_handle` - Instancia de la aplicación Tauri.
    /// * `url_str` - URL completa de WebSocket a la cual conectarse.
    /// * `logs` - Búfer de logs en memoria para el sistema de diagnóstico.
    pub async fn start(&self, app_handle: AppHandle, url_str: String, logs: AppLogs) {
        let mut tx_guard = self.tx.lock().await;
        let mut handle_guard = self.handle.lock().await;

        if let Some(handle) = handle_guard.take() {
            handle.abort();
        }

        *tx_guard = None;
        self.pending_queue.lock().await.clear();

        {
            let mut met = self.ws_metrics.lock().await;
            met.connected = false;
            met.last_disconnected_at_ms = Some(chrono::Utc::now().timestamp_millis());
        }

        let (tx, rx) = mpsc::unbounded_channel::<CloudOutgoingMessage>();
        *tx_guard = Some(tx.clone());

        let (ready_tx, ready_rx) = oneshot::channel::<()>();

        // Tarea en segundo plano para drenar la cola pendiente una vez confirmado el handshake
        let pending_queue = Arc::clone(&self.pending_queue);
        let tx_for_drain = tx.clone();
        tokio::spawn(async move {
            if ready_rx.await.is_ok() {
                let mut queue = pending_queue.lock().await;
                for msg in queue.drain(..) {
                    let _ = tx_for_drain.send(msg);
                }
            }
        });

        let app_handle_clone = app_handle.clone();
        let metrics = Arc::clone(&self.ws_metrics);

        let join_handle = tokio::spawn(async move {
            start_ws_loop(
                app_handle_clone,
                url_str,
                rx,
                logs,
                Some(ready_tx),
                Some(metrics),
            )
            .await;
        });

        *handle_guard = Some(join_handle);
    }

    /// Detiene manualmente la conexión WebSocket activa y libera los recursos asíncronos.
    /// La cola de cold-start se vacía para evitar el envío de mensajes obsoletos tras reiniciar.
    pub async fn stop(&self) {
        let mut tx_guard = self.tx.lock().await;
        let mut handle_guard = self.handle.lock().await;

        if let Some(handle) = handle_guard.take() {
            handle.abort();
        }

        *tx_guard = None;
        self.pending_queue.lock().await.clear();

        let mut met = self.ws_metrics.lock().await;
        met.connected = false;
        met.last_disconnected_at_ms = Some(chrono::Utc::now().timestamp_millis());
    }

    /// Envía un mensaje si la conexión está lista, o lo encola en la cola de arranque en frío.
    async fn send_or_enqueue(&self, msg: CloudOutgoingMessage) -> Result<(), String> {
        let tx_guard = self.tx.lock().await;

        if let Some(tx) = tx_guard.as_ref() {
            tx.send(msg)
                .map_err(|e| format!("Fallo al encolar mensaje saliente: {}", e))?;
        } else {
            self.pending_queue.lock().await.push(msg);
        }

        Ok(())
    }

    /// Envía un mensaje de presencia/difusión de juego hacia la nube.
    ///
    /// # Argumentos
    /// * `payload` - Datos del broadcast de presencia del usuario.
    pub async fn send_broadcast(&self, payload: CloudBroadcastPayload) -> Result<(), String> {
        self.send_or_enqueue(CloudOutgoingMessage::Broadcast(payload))
            .await
    }

    /// Envía una señal de control/streaming WebRTC hacia la nube.
    ///
    /// # Argumentos
    /// * `payload` - Datos de la señal de streaming.
    pub async fn send_stream_signal(
        &self,
        payload: CloudStreamSignalPayload,
    ) -> Result<(), String> {
        self.send_or_enqueue(CloudOutgoingMessage::StreamSignal(payload))
            .await
    }
}
