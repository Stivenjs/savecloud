//! # AppDb
//!
//! Gestor de conexión SQLite optimizado con Pool de Conexiones (`r2d2`).
//!
//! ## Características
//! - Pool de múltiples conexiones (adiós al Mutex global)
//! - WAL habilitado (lecturas concurrentes reales mientras se escribe)
//! - PRAGMAs optimizados para rendimiento

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;

use crate::config::paths;
use crate::sqlite::error::SqliteError;
use crate::sqlite::migrations::run_migrations;
use crate::steam_catalog::normalize::backfill_name_normalized_if_needed;

/// Estado compartido de la base SQLite usando un Pool de conexiones.
///
/// Internamente usa [`r2d2::Pool`] para garantizar lecturas y escrituras
/// concurrentes sin bloqueos, gracias al modo WAL de SQLite.
///
/// Es barato de clonar: todos los clones comparten el mismo pool subyacente.
#[derive(Clone)]
pub struct AppDb {
    pool: Pool<SqliteConnectionManager>,
}

impl AppDb {
    pub const DEFAULT_MIN_PAGES_FOR_COMPACTION: i64 = 500;
    pub const DEFAULT_FRAGMENTATION_THRESHOLD_PERCENT: f64 = 25.0;
    /// Abre o crea la base de datos SQLite en disco y configura el Pool.
    ///
    /// Resuelve la ruta del archivo mediante [`paths::sqlite_catalog_path`],
    /// crea los directorios padre si no existen, aplica los PRAGMAs de
    /// rendimiento a cada conexión nueva del pool, ejecuta las migraciones
    /// pendientes y rellena la columna `name_normalized` si hace falta.
    ///
    /// # Returns
    /// Un [`AppDb`] listo para usar con el pool ya inicializado.
    ///
    /// # Errors
    /// - [`SqliteError::PathNotResolved`] si no se puede obtener la ruta del archivo.
    /// - [`SqliteError::Io`] si falla la creación de directorios padre.
    /// - [`SqliteError::Pool`] si el pool no puede crearse o si la
    ///   conexión inicial para migraciones no está disponible.
    /// - Errores propagados desde [`run_migrations`] o [`backfill_name_normalized_if_needed`].
    ///
    /// # Examples
    /// ```no_run
    /// let db = AppDb::open().expect("No se pudo abrir la base de datos");
    /// ```
    pub fn open() -> Result<Self, SqliteError> {
        let path = resolve_catalog_path()?;

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let manager = SqliteConnectionManager::file(&path).with_init(|conn| {
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "synchronous", "NORMAL")?;
            conn.pragma_update(None, "foreign_keys", "ON")?;
            conn.pragma_update(None, "wal_autocheckpoint", 1000)?;
            conn.pragma_update(None, "temp_store", "MEMORY")?;
            conn.pragma_update(None, "busy_timeout", 5000)?;
            conn.pragma_update(None, "cache_size", -65536)?;
            conn.pragma_update(None, "mmap_size", 536870912)?;
            conn.pragma_update(None, "page_size", 4096)?;
            Ok(())
        });

        let pool = Pool::builder()
            .max_size(16)
            .min_idle(Some(4))
            .build(manager)
            .map_err(|e| SqliteError::Pool(e.to_string()))?;

        let conn = pool.get().map_err(|e| SqliteError::Pool(e.to_string()))?;
        run_migrations(&conn)?;
        backfill_name_normalized_if_needed(&conn)?;

        Ok(Self { pool })
    }

    /// Verifica que el Pool pueda entregar una conexión operativa.
    ///
    /// Ejecuta `SELECT 1` sobre una conexión real del pool para confirmar
    /// que la base de datos responde correctamente.
    ///
    /// # Returns
    /// `Ok(())` si la conexión está activa y SQLite responde.
    ///
    /// # Errors
    /// - [`SqliteError::Pool`] si el pool no puede entregar una conexión.
    /// - [`SqliteError`] si la query falla por cualquier razón.
    pub fn ping(&self) -> Result<(), SqliteError> {
        self.with_conn(|conn| conn.query_row("SELECT 1", [], |_| Ok(())))
    }

    /// Obtiene una conexión del Pool y ejecuta el closure recibido.
    ///
    /// Si otro hilo está realizando un INSERT masivo, este método entregará
    /// una conexión *diferente*, permitiendo que SELECTs concurrentes no se
    /// bloqueen (gracias al WAL).
    ///
    /// # Parameters
    /// - `f`: Closure que recibe una referencia a [`Connection`] y retorna
    ///   `Result<T, rusqlite::Error>`. Se ejecuta de forma síncrona antes
    ///   de devolver la conexión al pool.
    ///
    /// # Returns
    /// El valor `T` producido por el closure, envuelto en `Ok`.
    ///
    /// # Errors
    /// - [`SqliteError::Pool`] si el pool no puede entregar una conexión.
    /// - Cualquier [`SqliteError`] que el closure propague internamente.
    pub fn with_conn<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    ) -> Result<T, SqliteError> {
        let conn = self
            .pool
            .get()
            .map_err(|e| SqliteError::Pool(e.to_string()))?;
        f(&conn).map_err(SqliteError::from)
    }

    /// Consolida el WAL y compacta el archivo de la base de datos.
    ///
    /// Ejecuta `PRAGMA wal_checkpoint(FULL)` seguido de `VACUUM` para
    /// reducir el tamaño en disco y eliminar páginas libres acumuladas.
    ///
    /// # Returns
    /// `Ok(())` si ambas operaciones completan sin error.
    ///
    /// # Errors
    /// Propaga cualquier [`SqliteError`] devuelto por [`Self::with_conn`].
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

    /// Compacta la base de datos escribiendo el resultado en una ruta distinta.
    ///
    /// Usa `VACUUM INTO` para exportar una copia limpia y compactada sin
    /// modificar el archivo original.
    ///
    /// # Parameters
    /// - `output_path`: Ruta absoluta o relativa del archivo de destino.
    ///   Si ya existe, será sobreescrito.
    ///
    /// # Returns
    /// `Ok(())` si `VACUUM INTO` completa correctamente.
    ///
    /// # Errors
    /// Propaga cualquier [`SqliteError`] devuelto por [`Self::with_conn`].
    #[allow(dead_code)]
    pub fn compact_into(&self, output_path: &str) -> Result<(), SqliteError> {
        self.with_conn(|conn| {
            let query = format!("VACUUM INTO '{}';", output_path);
            conn.execute_batch(&query)
        })
    }

    /// Ejecuta un checkpoint del WAL con el modo indicado.
    ///
    /// Un checkpoint vuelca las páginas del WAL al archivo principal,
    /// controlando cuánto trabajo se realiza según el modo elegido.
    ///
    /// # Parameters
    /// - `mode`: Modo de checkpoint. Valores válidos de SQLite:
    ///   `"PASSIVE"`, `"FULL"`, `"RESTART"` o `"TRUNCATE"`.
    ///
    /// # Returns
    /// `Ok(())` si el checkpoint se ejecuta sin error.
    ///
    /// # Errors
    /// Propaga cualquier [`SqliteError`] devuelto por [`Self::with_conn`].
    pub fn checkpoint(&self, mode: &str) -> Result<(), SqliteError> {
        self.with_conn(|conn| {
            let query = format!("PRAGMA wal_checkpoint({});", mode);
            conn.execute_batch(&query)
        })
    }

    /// Ejecuta `wal_checkpoint(TRUNCATE)` para compactar el WAL al mínimo.
    pub fn checkpoint_truncate(&self) -> Result<(), SqliteError> {
        self.checkpoint("TRUNCATE")
    }

    /// Retorna estadísticas básicas del archivo SQLite.
    ///
    /// Consulta `PRAGMA page_count` y `PRAGMA freelist_count` para estimar
    /// el tamaño total de la base y el espacio recuperable con un `VACUUM`.
    ///
    /// # Returns
    /// Una tupla `(page_count, freelist_count)` donde:
    /// - `page_count`: número total de páginas en el archivo.
    /// - `freelist_count`: páginas marcadas como libres (fragmentación).
    ///
    /// # Errors
    /// Propaga cualquier [`SqliteError`] devuelto por [`Self::with_conn`].
    ///
    /// # Examples
    /// ```no_run
    /// let (total, free) = db.stats()?;
    /// println!("Páginas totales: {total}, libres: {free}");
    /// ```
    pub fn stats(&self) -> Result<(i64, i64), SqliteError> {
        self.with_conn(|conn| {
            let page_count: i64 = conn.query_row("PRAGMA page_count;", [], |row| row.get(0))?;
            let freelist_count: i64 =
                conn.query_row("PRAGMA freelist_count;", [], |row| row.get(0))?;
            Ok((page_count, freelist_count))
        })
    }

    /// Compacta la DB solo si la fragmentación supera el umbral.
    ///
    /// Retorna `Ok(true)` cuando se ejecutó `VACUUM`, `Ok(false)` cuando se omitió.
    pub fn compact_if_fragmented(
        &self,
        min_total_pages: i64,
        fragmentation_threshold_percent: f64,
    ) -> Result<bool, SqliteError> {
        let (total, free) = self.stats()?;
        if total <= 0 || total < min_total_pages {
            return Ok(false);
        }
        let fragmentation = (free as f64 / total as f64) * 100.0;
        if fragmentation >= fragmentation_threshold_percent {
            self.compact()?;
            return Ok(true);
        }
        Ok(false)
    }
}

fn resolve_catalog_path() -> Result<std::path::PathBuf, SqliteError> {
    let primary = paths::sqlite_catalog_path().ok_or(SqliteError::PathNotResolved)?;
    if primary.exists() {
        return Ok(primary);
    }
    if let Some(legacy) = paths::legacy_sqlite_catalog_path() {
        if legacy.exists() {
            return Ok(legacy);
        }
    }
    Ok(primary)
}
