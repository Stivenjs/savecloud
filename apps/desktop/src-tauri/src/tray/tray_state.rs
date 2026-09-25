//! Estado del icono de bandeja y tooltip: "Idle", "Sincronizando…", "N juegos con cambios pendientes".

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tauri::tray::TrayIcon;

pub struct TrayStateInner {
    pub tray: TrayIcon,
    syncing_count: AtomicU32,
    unsynced_count: Mutex<Option<u32>>,
    /// Pide cancelar la subida en curso (subida multipart lo comprueba entre partes).
    upload_cancel: AtomicBool,
    /// Pide pausar la subida (se guarda estado en disco y se puede reanudar después).
    upload_pause: AtomicBool,
    /// Juego restaurado recientemente (backup desde nube); el watcher no debe auto-subir ese juego.
    last_restored: Mutex<Option<(String, Instant)>>,
}

impl TrayStateInner {
    pub fn new(tray: TrayIcon) -> Self {
        Self {
            tray,
            syncing_count: AtomicU32::new(0),
            unsynced_count: Mutex::new(None),
            upload_cancel: AtomicBool::new(false),
            upload_pause: AtomicBool::new(false),
            last_restored: Mutex::new(None),
        }
    }

    /// Marca que se acaba de restaurar un juego desde un backup empaquetado. El watcher no hará
    /// auto-subida de ese juego hasta que el usuario haga "Subir" manualmente (solo extraemos en PC,
    /// no tiene sentido subir lo extraído a S3).
    pub fn set_just_restored(&self, game_id: &str) {
        if let Ok(mut g) = self.last_restored.lock() {
            *g = Some((game_id.to_lowercase(), Instant::now()));
        }
    }

    /// True si este juego fue restaurado y aún no debe disparar auto-subida (solo se limpia al hacer "Subir" manual).
    #[allow(dead_code)] // Solo usado por watch_sync (deshabilitado por ahora).
    pub fn was_just_restored(&self, game_id: &str) -> bool {
        let key = game_id.to_lowercase();
        if let Ok(g) = self.last_restored.lock() {
            if let Some((id, _)) = g.as_ref() {
                return id == &key;
            }
        }
        false
    }

    /// Limpia el estado de "restaurado" para este juego (llamar cuando el usuario hace "Subir" manual).
    pub fn clear_restore_cooldown(&self, game_id: &str) {
        let key = game_id.to_lowercase();
        if let Ok(mut g) = self.last_restored.lock() {
            if g.as_ref().map(|(id, _)| id == &key).unwrap_or(false) {
                *g = None;
            }
        }
    }

    /// Marca que se solicita pausar la subida en curso.
    pub fn request_upload_pause(&self) {
        self.upload_pause.store(true, Ordering::Release);
    }

    /// Resetea el flag de pausa (llamar al iniciar una subida).
    pub fn reset_upload_pause(&self) {
        self.upload_pause.store(false, Ordering::Release);
    }

    /// True si se ha pedido pausar la subida.
    pub fn upload_pause_requested(&self) -> bool {
        self.upload_pause.load(Ordering::Acquire)
    }

    /// Marca que se solicita cancelar la subida en curso.
    pub fn request_upload_cancel(&self) {
        self.upload_cancel.store(true, Ordering::Release);
    }

    /// Resetea el flag de cancelación (llamar al iniciar una subida).
    pub fn reset_upload_cancel(&self) {
        self.upload_cancel.store(false, Ordering::Release);
    }

    /// True si se ha pedido cancelar la subida.
    pub fn upload_cancel_requested(&self) -> bool {
        self.upload_cancel.load(Ordering::Acquire)
    }

    pub fn syncing_inc(&self) {
        self.syncing_count.fetch_add(1, Ordering::Relaxed);
    }

    pub fn syncing_dec(&self) {
        self.syncing_count.fetch_sub(1, Ordering::Relaxed);
    }

    pub fn set_unsynced_count(&self, n: Option<u32>) {
        if let Ok(mut g) = self.unsynced_count.lock() {
            *g = n;
        }
    }

    /// Actualiza el tooltip según el estado actual.
    pub fn update_tooltip(&self) {
        let text = self.tooltip_text();
        let _ = self.tray.set_tooltip(Some(text.as_str()));
    }

    fn tooltip_text(&self) -> String {
        let syncing = self.syncing_count.load(Ordering::Relaxed);
        if syncing > 0 {
            return "Sincronizando…".to_string();
        }
        if let Ok(g) = self.unsynced_count.lock() {
            if let Some(n) = *g {
                if n > 0 {
                    return format!("{} juegos con cambios pendientes", n);
                }
            }
        }
        "Listo".to_string()
    }

    /// Actualiza en segundo plano el conteo de juegos sin sincronizar y el tooltip.
    pub fn refresh_unsynced_async(self: std::sync::Arc<Self>) {
        tauri::async_runtime::spawn(async move {
            if let Ok(list) = crate::commands::sync::download::sync_check_unsynced_games().await {
                self.set_unsynced_count(Some(list.len() as u32));
            }
            self.update_tooltip();
        });
    }
}

/// Estado compartido del tray (para app.manage y para pasar a threads).
#[derive(Clone)]
pub struct TrayState(pub std::sync::Arc<TrayStateInner>);

impl TrayState {
    pub fn new(tray: TrayIcon) -> Self {
        Self(std::sync::Arc::new(TrayStateInner::new(tray)))
    }
}
