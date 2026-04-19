//! Gestión de estado y mensajería IPC para el WebSocket de SaveCloud.
//!
//! Este archivo permite a Tauri controlar el ciclo de vida de la conexión y
//! coordinar el envío de mensajes desde la UI hacia el servidor WebSocket.

use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

use super::ws_client::{
    start_ws_loop, CloudBroadcastPayload, CloudOutgoingMessage, CloudStreamSignalPayload,
};
use crate::plugins::log_buffer::AppLogs;

/// Estado compartido del WebSocket de la nube gestionado por Tauri.
///
/// Este objeto permite a los comandos de Tauri interactuar con el bucle de
/// fondo que mantiene la conexión activa y segura.
pub struct CloudWsState {
    /// Canal para enviar mensajes salientes al hilo de fondo del WebSocket.
    /// Si es `None`, significa que la conexión aún no ha detectado intención de inicio.
    pub tx: Arc<Mutex<Option<mpsc::UnboundedSender<CloudOutgoingMessage>>>>,

    /// Handle de la tarea de tokio encargada del bucle de red.
    /// Guardado para permitir la finalización de la tarea si se detiene el servicio.
    pub handle: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl CloudWsState {
    /// Crea una nueva instancia del estado inicial (desconectado).
    pub fn new() -> Self {
        Self {
            tx: Arc::new(Mutex::new(None)),
            handle: Arc::new(Mutex::new(None)),
        }
    }

    /// Inicia la conexión WebSocket en un hilo de fondo si no está ya activa.
    ///
    /// # Arguments
    /// * `app_handle` - Instancia de Tauri para la comunicación IPC.
    /// * `url_str` - URL autenticada generada en el backend de Rust.
    /// * `logs` - Buffer de logs en memoria para el usuario.
    pub async fn start(&self, app_handle: AppHandle, url_str: String, logs: AppLogs) {
        let mut tx_guard = self.tx.lock().await;
        let mut handle_guard = self.handle.lock().await;

        // Evitar múltiples hilos de conexión simultáneos.
        if tx_guard.is_some() {
            return;
        }

        let (tx, rx) = mpsc::unbounded_channel::<CloudOutgoingMessage>();
        *tx_guard = Some(tx);

        let app_handle_clone = app_handle.clone();

        // Spawnear la tarea de fondo en el runtime de tokio de Tauri.
        let join_handle = tokio::spawn(async move {
            start_ws_loop(app_handle_clone, url_str, rx, logs).await;
        });

        *handle_guard = Some(join_handle);
    }

    /// Detiene la conexión WebSocket y libera los recursos del hilo de fondo.
    pub async fn stop(&self) {
        let mut tx_guard = self.tx.lock().await;
        let mut handle_guard = self.handle.lock().await;

        if let Some(handle) = handle_guard.take() {
            handle.abort();
        }

        *tx_guard = None;
    }

    /// Envía un mensaje broadcast al servidor.
    ///
    /// # Arguments
    /// * `payload` - Los datos del broadcast (gameId, gameName, etc).
    pub async fn send_broadcast(&self, payload: CloudBroadcastPayload) -> Result<(), String> {
        let tx_guard = self.tx.lock().await;

        if let Some(tx) = tx_guard.as_ref() {
            tx.send(CloudOutgoingMessage::Broadcast(payload))
                .map_err(|e| format!("Fallo al encolar broadcast: {}", e))?;
            Ok(())
        } else {
            Err("No hay una conexión WebSocket activa para enviar el broadcast.".to_string())
        }
    }

    pub async fn send_stream_signal(
        &self,
        payload: CloudStreamSignalPayload,
    ) -> Result<(), String> {
        let tx_guard = self.tx.lock().await;

        if let Some(tx) = tx_guard.as_ref() {
            tx.send(CloudOutgoingMessage::StreamSignal(payload))
                .map_err(|e| format!("Fallo al encolar signal de stream: {}", e))?;
            Ok(())
        } else {
            Err("No hay una conexión WebSocket activa para enviar la señal de stream.".to_string())
        }
    }
}
