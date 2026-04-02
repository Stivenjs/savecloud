//! Conexión única a `catalog.sqlite` bajo el directorio de datos de la app.

use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::config::paths;
use crate::sqlite::error::SqliteError;
use crate::sqlite::migrations::run_migrations;
use crate::steam_catalog::normalize::backfill_name_normalized_if_needed;

/// Estado compartido de la base SQLite del catálogo (un proceso → una conexión escrita aquí).
///
/// Las consultas desde comandos Tauri deben usar [`Self::with_conn`] para no exponer
/// `Mutex` al resto del crate de forma desordenada.
///
/// [`Clone`] duplica el [`Arc`]: misma conexión física, para poder pasar la DB a hilos
/// de sincronización sin bloquear el runtime async.
#[derive(Clone)]
pub struct AppDb {
    inner: Arc<Mutex<Connection>>,
}

impl AppDb {
    /// Abre o crea el archivo, aplica PRAGMAs seguros y migraciones.
    pub fn open() -> Result<Self, SqliteError> {
        let path = paths::sqlite_catalog_path().ok_or(SqliteError::PathNotResolved)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&path)?;
        // WAL: lecturas concurrentes con un escritor; adecuado para UI + sync en background.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;

        run_migrations(&conn)?;
        backfill_name_normalized_if_needed(&conn)?;

        Ok(Self {
            inner: Arc::new(Mutex::new(conn)),
        })
    }

    /// Comprueba que la conexión responde (diagnósticos y arranque).
    pub fn ping(&self) -> Result<(), SqliteError> {
        self.with_conn(|conn| conn.query_row("SELECT 1", [], |_| Ok(())))
    }

    /// Ejecuta `f` con la conexión bloqueada. Preferible a filtrar `Mutex` fuera del módulo.
    pub fn with_conn<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    ) -> Result<T, SqliteError> {
        let guard = self.inner.lock().map_err(|_| SqliteError::MutexPoisoned)?;
        f(&guard).map_err(SqliteError::from)
    }
}
