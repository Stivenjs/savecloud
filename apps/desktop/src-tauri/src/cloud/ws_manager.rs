//! Gestión de estado y mensajería IPC para el WebSocket de SaveCloud.
//!
//! Este archivo permite a Tauri controlar el ciclo de vida de la conexión y
//! coordinar el envío de mensajes desde la UI hacia el servidor WebSocket.
//!
//! ## Cold-start buffer
//! Los mensajes enviados *antes* de que el WS esté completamente conectado se
//! guardan en `pending_queue`. En cuanto el bucle de red confirma que la
//! conexión se estableció (señal `ready_notify`), el manager drena la cola
//! automáticamente sin perder ningún evento.

use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::task::JoinHandle;

use super::ws_client::{
    start_ws_loop, CloudBroadcastPayload, CloudOutgoingMessage, CloudStreamSignalPayload,
};
use crate::plugins::log_buffer::AppLogs;

/// Estado compartido del WebSocket de la nube gestionado por Tauri.
pub struct CloudWsState {
    /// Canal para enviar mensajes salientes al hilo de fondo del WebSocket.
    /// `None` significa que la conexión todavía no está activa.
    pub tx: Arc<Mutex<Option<mpsc::UnboundedSender<CloudOutgoingMessage>>>>,

    /// Handle de la tarea de tokio encargada del bucle de red.
    pub handle: Arc<Mutex<Option<JoinHandle<()>>>>,

    /// Cola de mensajes enviados *antes* de que el WS estuviese listo.
    /// Se drena automáticamente en cuanto la conexión se establece.
    pending_queue: Arc<Mutex<Vec<CloudOutgoingMessage>>>,
}

impl CloudWsState {
    pub fn new() -> Self {
        Self {
            tx: Arc::new(Mutex::new(None)),
            handle: Arc::new(Mutex::new(None)),
            pending_queue: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Inicia la conexión WebSocket en un hilo de fondo si no está ya activa.
    pub async fn start(&self, app_handle: AppHandle, url_str: String, logs: AppLogs) {
        let mut tx_guard = self.tx.lock().await;
        let mut handle_guard = self.handle.lock().await;

        // Evitar múltiples hilos de conexión simultáneos.
        if tx_guard.is_some() {
            return;
        }

        let (tx, rx) = mpsc::unbounded_channel::<CloudOutgoingMessage>();
        *tx_guard = Some(tx.clone());

        // Canal one-shot:
        //   ready_tx  →  se entrega al bucle de red; lo dispara al conectar
        //   ready_rx  →  lo escucha la tarea de drenado aquí abajo
        let (ready_tx, ready_rx) = oneshot::channel::<()>();

        // Tarea auxiliar: espera la señal de "listo" y drena la cola pendiente.
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

        let join_handle = tokio::spawn(async move {
            start_ws_loop(app_handle_clone, url_str, rx, logs, Some(ready_tx)).await;
        });

        *handle_guard = Some(join_handle);
    }

    /// Detiene la conexión WebSocket y libera los recursos del hilo de fondo.
    /// La cola pendiente se limpia para no acumular mensajes obsoletos.
    pub async fn stop(&self) {
        let mut tx_guard = self.tx.lock().await;
        let mut handle_guard = self.handle.lock().await;

        if let Some(handle) = handle_guard.take() {
            handle.abort();
        }

        *tx_guard = None;

        // Limpiar cola para que el próximo arranque empiece limpio.
        self.pending_queue.lock().await.clear();
    }

    /// Envía inmediatamente si el WS ya está activo, o encola para después.
    async fn send_or_enqueue(&self, msg: CloudOutgoingMessage) -> Result<(), String> {
        let tx_guard = self.tx.lock().await;

        if let Some(tx) = tx_guard.as_ref() {
            tx.send(msg)
                .map_err(|e| format!("Fallo al encolar mensaje: {}", e))?;
        } else {
            // WS todavía no listo (cold start): guardar para cuando conecte.
            self.pending_queue.lock().await.push(msg);
        }

        Ok(())
    }

    pub async fn send_broadcast(&self, payload: CloudBroadcastPayload) -> Result<(), String> {
        self.send_or_enqueue(CloudOutgoingMessage::Broadcast(payload))
            .await
    }

    pub async fn send_stream_signal(
        &self,
        payload: CloudStreamSignalPayload,
    ) -> Result<(), String> {
        self.send_or_enqueue(CloudOutgoingMessage::StreamSignal(payload))
            .await
    }
}
