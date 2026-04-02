//! # AppDb
//!
//! Gestor de conexión SQLite optimizado para workloads de catálogo (lectura + sync).
//!
//! ## Características
//! - Una sola conexión compartida (`Arc<Mutex<_>>`)
//! - WAL habilitado (lecturas concurrentes + escritura segura)
//! - PRAGMAs optimizados para rendimiento
//! - Métodos de mantenimiento (checkpoint + vacuum)
//!
//! ## Uso recomendado
//! ```ignore
//! let db = AppDb::open()?;
//! db.ping()?;
//!
//! db.with_conn(|conn| {
//!     conn.execute("SELECT 1", [])?;
//!     Ok(())
//! })?;
//! ```
//!
//! ## Notas
//! - Usar [`compact`] periódicamente si hay muchas escrituras/borrados.
//! - Para producción, preferir [`compact_into`] para evitar riesgos.
//!

use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::config::paths;
use crate::sqlite::error::SqliteError;
use crate::sqlite::migrations::run_migrations;
use crate::steam_catalog::normalize::backfill_name_normalized_if_needed;

/// Estado compartido de la base SQLite.
///
/// Internamente usa un `Arc<Mutex<Connection>>` para garantizar:
/// - Seguridad en concurrencia
/// - Una única conexión real al archivo
#[derive(Clone)]
pub struct AppDb {
    inner: Arc<Mutex<Connection>>,
}

impl AppDb {
    /// Abre o crea la base de datos SQLite.
    ///
    /// ## Qué hace
    /// - Crea el directorio si no existe
    /// - Abre la conexión
    /// - Aplica PRAGMAs de optimización
    /// - Ejecuta migraciones
    /// - Ejecuta backfills necesarios
    ///
    /// ## PRAGMAs aplicados
    /// - `journal_mode = WAL`
    /// - `synchronous = NORMAL`
    /// - `foreign_keys = ON`
    /// - `wal_autocheckpoint = 1000`
    ///
    /// ## Errores
    /// Retorna [`SqliteError`] si falla cualquier paso.
    pub fn open() -> Result<Self, SqliteError> {
        let path = paths::sqlite_catalog_path().ok_or(SqliteError::PathNotResolved)?;

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&path)?;

        // PRAGMAs de rendimiento
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        // Controla crecimiento del WAL automáticamente
        conn.pragma_update(None, "wal_autocheckpoint", 1000)?;

        // Opcional: mejora rendimiento en lecturas
        conn.pragma_update(None, "temp_store", "MEMORY")?;

        run_migrations(&conn)?;
        backfill_name_normalized_if_needed(&conn)?;

        Ok(Self {
            inner: Arc::new(Mutex::new(conn)),
        })
    }

    /// Verifica que la conexión esté operativa.
    ///
    /// Útil para checks de arranque o health checks.
    pub fn ping(&self) -> Result<(), SqliteError> {
        self.with_conn(|conn| conn.query_row("SELECT 1", [], |_| Ok(())))
    }

    /// Ejecuta una función con acceso exclusivo a la conexión.
    ///
    /// ## Ventajas
    /// - Evita exponer el `Mutex`
    /// - Centraliza manejo de errores
    ///
    /// ## Ejemplo
    /// ```ignore
    /// db.with_conn(|conn| {
    ///     conn.execute("INSERT INTO test VALUES (?)", [1])?;
    ///     Ok(())
    /// })?;
    /// ```
    pub fn with_conn<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    ) -> Result<T, SqliteError> {
        let guard = self.inner.lock().map_err(|_| SqliteError::MutexPoisoned)?;
        f(&guard).map_err(SqliteError::from)
    }

    /// Realiza mantenimiento de la base de datos.
    ///
    /// ## Qué hace
    /// 1. Ejecuta checkpoint del WAL
    /// 2. Compacta la base (`VACUUM`)
    ///
    /// ## Cuándo usarlo
    /// - Después de sincronizaciones grandes
    /// - Cuando el tamaño del archivo crece demasiado
    ///
    /// ## Nota
    /// Bloquea la base temporalmente.
    pub fn compact(&self) -> Result<(), SqliteError> {
        self.with_conn(|conn| {
            conn.execute_batch(
                "
                PRAGMA wal_checkpoint(FULL);
                VACUUM;
                ",
            )
        })
    }

    /// Compacta la base en un nuevo archivo (método seguro).
    ///
    /// ## Ventajas
    /// - No bloquea tanto como `VACUUM`
    /// - Permite validar antes de reemplazar
    /// - Ideal para producción
    ///
    /// ## Flujo recomendado
    /// 1. Ejecutar este método
    /// 2. Verificar archivo generado
    /// 3. Reemplazar DB original
    ///
    /// ## Ejemplo
    /// ```ignore
    /// db.compact_into("catalog_compact.sqlite")?;
    /// ```
    #[allow(dead_code)]
    pub fn compact_into(&self, output_path: &str) -> Result<(), SqliteError> {
        self.with_conn(|conn| {
            let query = format!("VACUUM INTO '{}';", output_path);
            conn.execute_batch(&query)
        })
    }

    /// Ejecuta manualmente un checkpoint del WAL.
    ///
    /// ## Tipos posibles
    /// - `PASSIVE`
    /// - `FULL`
    /// - `RESTART`
    /// - `TRUNCATE`
    ///
    /// ## Uso típico
    /// ```ignore
    /// db.checkpoint("FULL")?;
    /// ```
    pub fn checkpoint(&self, mode: &str) -> Result<(), SqliteError> {
        self.with_conn(|conn| {
            let query = format!("PRAGMA wal_checkpoint({});", mode);
            conn.execute_batch(&query)
        })
    }

    /// Retorna estadísticas internas de la base.
    ///
    /// ## Devuelve
    /// `(page_count, freelist_count)`
    ///
    /// - `page_count`: total de páginas
    /// - `freelist_count`: páginas libres (espacio desperdiciado)
    pub fn stats(&self) -> Result<(i64, i64), SqliteError> {
        self.with_conn(|conn| {
            let page_count: i64 = conn.query_row("PRAGMA page_count;", [], |row| row.get(0))?;

            let freelist_count: i64 =
                conn.query_row("PRAGMA freelist_count;", [], |row| row.get(0))?;

            Ok((page_count, freelist_count))
        })
    }
}
