//! Streaming de directorios como archivos TAR comprimidos con ZSTD hacia un canal de chunks.
//!
//! Este módulo integra `tar-rs` con `zstd` y un `tokio::sync::mpsc` para producir un
//! flujo de chunks (`bytes::Bytes`) comprimidos a medida que se genera el archivo,
//! evitando almacenamiento intermedio en disco.
//!
//! Soporta tanto juegos de una única ruta de guardado como juegos con múltiples rutas
//! configuradas (ej. carpeta de partidas en AppData y configuración en Documents),
//! empaquetando cada ruta con su prefijo lógico correspondiente.
//!
//! La generación del TAR y la compresión se ejecutan en un hilo blocking mediante
//! [`tokio::task::spawn_blocking`]. Los datos comprimidos se escriben en un
//! [`ChannelWriter`], que implementa [`std::io::Write`] y se encarga de
//! fragmentarlos en chunks de tamaño fijo antes de enviarlos al canal.
//!
//! El consumidor recibe una secuencia de [`TarStreamMsg`] que representa:
//!
//! - [`TarStreamMsg::Chunk`]: datos del archivo comprimido en orden de generación.
//! - [`TarStreamMsg::Done`]: finalización correcta del stream con estadísticas.
//! - [`TarStreamMsg::Err`]: fallo durante el empaquetado, compresión o envío.
//!
//! El canal actúa como mecanismo de backpressure, limitando la producción
//! según su capacidad configurada e impidiendo que la compresión llene la RAM.

use std::io::{self, Write};
use std::path::{Path, PathBuf};

use bytes::{BufMut, BytesMut};
use walkdir::WalkDir;

use super::upload_strategy::TAR_STREAM_CHUNK_BYTES;
use crate::commands::logs::sync_logger;
use crate::utils::path_utils;

/// Estadísticas recolectadas durante el empaquetado del directorio en formato TAR.
#[derive(Debug, Clone, Copy, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TarStreamStats {
    pub files_count: u64,
    pub dirs_count: u64,
    pub symlinks_count: u64,
    pub uncompressed_bytes: u64,
}

/// Mensajes que el hilo TAR envía al consumidor async.
#[derive(Debug)]
pub(crate) enum TarStreamMsg {
    /// Chunk de bytes comprimidos listos para subir.
    /// Incluye la cantidad total de bytes originales [`TAR_STREAM_CHUNK_BYTES`] (sin comprimir) procesados hasta ahora
    /// para que el contador de progreso sea exacto.
    Chunk(bytes::Bytes, u64),
    /// El archivo se generó y comprimió totalmente; todos los bytes fueron enviados con sus estadísticas.
    Done(TarStreamStats),
    /// Error irrecuperable durante la generación, compresión o envío al canal.
    Err(String),
}

/// Implementa [`Write`] sobre un canal [`tokio::sync::mpsc`], acumulando bytes
/// en un [`BytesMut`] y enviando chunks al alcanzar el umbral configurado.
///
/// Ver el módulo raíz para la explicación del diseño sin copias.
struct ChannelWriter {
    tx: tokio::sync::mpsc::Sender<TarStreamMsg>,
    /// Buffer pre-reservado con capacidad para al menos un chunk completo.
    buf: BytesMut,
    /// Referencia compartida al contador de bytes originales procesados.
    original_processed: std::sync::Arc<std::sync::atomic::AtomicU64>,
}

impl ChannelWriter {
    /// Crea un nuevo `ChannelWriter` con buffer pre-reservado y contador de progreso.
    fn new(
        tx: tokio::sync::mpsc::Sender<TarStreamMsg>,
        original_processed: std::sync::Arc<std::sync::atomic::AtomicU64>,
    ) -> Self {
        Self {
            tx,
            buf: BytesMut::with_capacity(TAR_STREAM_CHUNK_BYTES),
            original_processed,
        }
    }

    /// Envía el contenido actual del buffer como un chunk y resetea el buffer.
    ///
    /// `split_to(len).freeze()` es O(1): no copia bytes, solo ajusta los punteros
    /// internos del `BytesMut`. El buffer principal queda apuntando al espacio
    /// contiguo restante del mismo bloque de memoria.
    fn flush_chunk(&mut self) -> io::Result<()> {
        if self.buf.is_empty() {
            return Ok(());
        }
        let chunk = self.buf.split_to(self.buf.len()).freeze();
        let processed = self
            .original_processed
            .load(std::sync::atomic::Ordering::Relaxed);

        self.tx
            .blocking_send(TarStreamMsg::Chunk(chunk, processed))
            .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "receptor descartado"))?;
        // Pre-reservar para el siguiente ciclo. No-op si `split_to` dejó
        // capacidad contigua disponible en el bloque existente.
        if self.buf.capacity() < TAR_STREAM_CHUNK_BYTES {
            self.buf.reserve(TAR_STREAM_CHUNK_BYTES);
        }
        Ok(())
    }
}

impl Write for ChannelWriter {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        // Fast path: buffer vacío y bloque entrante supera el umbral.
        // Una única copia directa al heap del `Bytes` final, sin pasar por
        // el buffer intermedio.
        if self.buf.is_empty() && data.len() >= TAR_STREAM_CHUNK_BYTES {
            let chunk = bytes::Bytes::copy_from_slice(data);
            let processed = self
                .original_processed
                .load(std::sync::atomic::Ordering::Relaxed);

            self.tx
                .blocking_send(TarStreamMsg::Chunk(chunk, processed))
                .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "receptor descartado"))?;
            return Ok(data.len());
        }

        // Path normal: acumular en el buffer pre-reservado.
        self.buf.put_slice(data);

        if self.buf.len() >= TAR_STREAM_CHUNK_BYTES {
            self.flush_chunk()?;
        }
        Ok(data.len())
    }

    /// Vacía bytes pendientes hacia el canal.
    /// Llamado por `tar-rs` durante `into_inner` para los bloques de terminación.
    fn flush(&mut self) -> io::Result<()> {
        self.flush_chunk()
    }
}

/// Lanza la generación del TAR en un hilo blocking y devuelve el receptor de chunks.
///
/// Soporta empaquetar una o múltiples rutas de guardado (`paths`).
///
/// # Parameters
///
/// - `paths`: lista de rutas sin expandir asociadas al juego. Se toma posesión para `'static`.
/// - `channel_capacity`: capacidad del canal mpsc. Debe ser `strategy.tar_channel_capacity`.
/// - `zstd_compression_level`: nivel de compresión Zstandard (1..=22).
///
/// # Return
///
/// `(Receiver<TarStreamMsg>, JoinHandle<()>)`. El canal se cierra con
/// [`TarStreamMsg::Done`] en el camino feliz o [`TarStreamMsg::Err`] ante fallo.
pub(crate) fn spawn_tar_stream(
    paths: Vec<String>,
    channel_capacity: usize,
    zstd_compression_level: i32,
) -> (
    tokio::sync::mpsc::Receiver<TarStreamMsg>,
    tokio::task::JoinHandle<()>,
) {
    let (tx, rx) = tokio::sync::mpsc::channel::<TarStreamMsg>(channel_capacity);

    let handle = tokio::task::spawn_blocking(move || {
        match run_tar_pipeline(&paths, tx.clone(), zstd_compression_level) {
            Ok(stats) => {
                let _ = tx.blocking_send(TarStreamMsg::Done(stats));
            }
            Err(e) => {
                let _ = tx.blocking_send(TarStreamMsg::Err(e));
            }
        }
        // `tx` se dropea aquí, cerrando el canal desde el lado productor.
    });

    (rx, handle)
}

/// Empaqueta una o múltiples rutas en formato TAR mediante un pipeline manual con `walkdir`.
///
/// - Si `paths` contiene 1 sola ruta: empaqueta relativo a la raíz directamente.
/// - Si `paths` contiene múltiples rutas: asigna prefijos de carpeta ([`path_utils::compute_sync_multi_root_prefixes`])
///   para preservar la separación de carpetas en el TAR.
/// - Normaliza todos los nombres de entradas con separador POSIX `/` para portabilidad entre plataformas.
fn run_tar_pipeline(
    paths: &[String],
    tx: tokio::sync::mpsc::Sender<TarStreamMsg>,
    zstd_compression_level: i32,
) -> Result<TarStreamStats, String> {
    if paths.is_empty() {
        return Err("No hay rutas configuradas para el juego".to_string());
    }

    // Contador compartido para trackear el progreso original (crudo) mientras zstd comprime.
    let original_counter = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));

    // Pipeline: tar::Builder -> ProgressWrapper -> zstd::Encoder -> ChannelWriter -> mpsc
    let writer = ChannelWriter::new(tx, original_counter.clone());

    let level = zstd_compression_level.clamp(1, 22);
    let mut encoder = zstd::Encoder::new(writer, level)
        .map_err(|e| format!("fallo al inicializar encoder Zstd: {}", e))?;

    let threads = (num_cpus::get() - 1).max(1) as u32;

    encoder
        .multithread(threads)
        .map_err(|e| format!("fallo activando multithread en zstd: {}", e))?;

    // Un simple wrapper que incrementa el contador por cada byte que el TAR escribe al encoder.
    struct ProgressWrapper<W: Write> {
        inner: W,
        counter: std::sync::Arc<std::sync::atomic::AtomicU64>,
    }
    impl<W: Write> Write for ProgressWrapper<W> {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            let n = self.inner.write(buf)?;
            self.counter
                .fetch_add(n as u64, std::sync::atomic::Ordering::Relaxed);
            Ok(n)
        }
        fn flush(&mut self) -> io::Result<()> {
            self.inner.flush()
        }
    }

    let progress_writer = ProgressWrapper {
        inner: encoder,
        counter: original_counter.clone(),
    };

    let mut builder = tar::Builder::new(progress_writer);
    builder.follow_symlinks(false);

    let mut files_count = 0u64;
    let mut dirs_count = 0u64;
    let mut symlinks_count = 0u64;
    let mut valid_roots_found = 0usize;

    let folder_prefixes = path_utils::compute_sync_multi_root_prefixes(paths);

    for (root_idx, raw) in paths.iter().enumerate() {
        let Some(expanded_str) = path_utils::expand_path(raw.trim()) else {
            sync_logger::log_error(
                "tar_stream",
                "run_tar_pipeline",
                &format!("No se pudo expandir la ruta: {}", raw),
            );
            continue;
        };

        let root_path = PathBuf::from(expanded_str);
        if !root_path.exists() {
            sync_logger::log_operation(
                "tar_stream",
                &format!(
                    "Ruta inexistente omitida en el backup: {}",
                    root_path.display()
                ),
            );
            continue;
        }

        valid_roots_found += 1;
        let prefix = folder_prefixes
            .get(root_idx)
            .map(|s| s.as_str())
            .unwrap_or("");

        if root_path.is_file() {
            files_count += 1;
            let file_name = root_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file");
            let tar_path = format!("{prefix}{file_name}");

            let mut file = std::fs::File::open(&root_path)
                .map_err(|e| format!("error abriendo '{}': {}", root_path.display(), e))?;

            builder
                .append_file(&tar_path, &mut file)
                .map_err(|e| format!("error empaquetando '{}': {}", tar_path, e))?;
        } else if root_path.is_dir() {
            if !prefix.is_empty() {
                // Registrar la carpeta raíz en el TAR si estamos en modo multi-ruta
                let root_dir_name = prefix.trim_end_matches('/');
                dirs_count += 1;
                let _ = builder.append_dir(root_dir_name, &root_path);
            }

            let walker = WalkDir::new(&root_path)
                .follow_links(false)
                .same_file_system(true)
                .into_iter();

            for entry_result in walker {
                let entry = match entry_result {
                    Ok(e) => e,
                    Err(e) => {
                        sync_logger::log_error(
                            "tar_stream",
                            "run_tar_pipeline",
                            &format!(
                                "Error recorriendo entrada en '{}': {}",
                                root_path.display(),
                                e
                            ),
                        );
                        continue;
                    }
                };

                let Ok(relative) = entry.path().strip_prefix(&root_path) else {
                    continue;
                };

                if relative == Path::new("") || relative == Path::new(".") {
                    continue;
                }

                // Normalizar separadores a '/' para compatibilidad TAR POSIX multiplataforma
                let rel_str = relative.to_string_lossy().replace('\\', "/");
                let tar_rel_path = format!("{prefix}{rel_str}");
                let file_type = entry.file_type();

                if file_type.is_dir() {
                    dirs_count += 1;
                    builder
                        .append_dir(&tar_rel_path, entry.path())
                        .map_err(|e| format!("error empaquetando dir '{}': {}", tar_rel_path, e))?;
                } else if file_type.is_file() {
                    files_count += 1;
                    let mut file = std::fs::File::open(entry.path()).map_err(|e| {
                        format!("error abriendo '{}': {}", entry.path().display(), e)
                    })?;

                    builder
                        .append_file(&tar_rel_path, &mut file)
                        .map_err(|e| format!("error empaquetando '{}': {}", tar_rel_path, e))?;
                } else if file_type.is_symlink() {
                    symlinks_count += 1;
                    builder
                        .append_path_with_name(entry.path(), &tar_rel_path)
                        .map_err(|e| {
                            format!("error empaquetando symlink '{}': {}", tar_rel_path, e)
                        })?;
                }
            }
        }
    }

    if valid_roots_found == 0 {
        return Err("Ninguna de las carpetas configuradas existe en el equipo".to_string());
    }

    // `into_inner` devuelve el ProgressWrapper.
    let progress_writer = builder
        .into_inner()
        .map_err(|e| format!("error finalizando TAR: {}", e))?;

    // Drenar el ProgressWrapper para recuperar el encoder Zstd.
    let zstd_encoder = progress_writer.inner;

    // `finish` garantiza que Zstd vacíe todos los bloques comprimidos pendientes y
    // escriba el footer del frame Zstd, devolviendo el ChannelWriter original.
    let mut channel_writer = zstd_encoder
        .finish()
        .map_err(|e| format!("error finalizando compresión Zstd: {}", e))?;

    // Flush final de defensa para garantizar que el último chunk incompleto
    // (si existe) se envíe al canal.
    channel_writer
        .flush_chunk()
        .map_err(|e| format!("error vaciando buffer final: {}", e))?;

    let uncompressed_bytes = original_counter.load(std::sync::atomic::Ordering::Relaxed);

    Ok(TarStreamStats {
        files_count,
        dirs_count,
        symlinks_count,
        uncompressed_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Cursor;

    struct TestDirGuard(PathBuf);
    impl Drop for TestDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn create_test_dir(name: &str) -> (PathBuf, TestDirGuard) {
        let path = std::env::temp_dir().join(format!(
            "savecloud_tar_test_{}_{}_{}",
            name,
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        let _ = fs::create_dir_all(&path);
        let guard = TestDirGuard(path.clone());
        (path, guard)
    }

    #[tokio::test]
    async fn tar_stream_single_path_should_package_and_decompress_properly() {
        let (root, _guard) = create_test_dir("single_path");
        let sub = root.join("slot1");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("save.dat"), b"hello world savegame").unwrap();

        let (mut rx, handle) = spawn_tar_stream(vec![root.to_string_lossy().to_string()], 8, 3);

        let mut compressed_data = Vec::new();
        let mut final_stats = None;

        while let Some(msg) = rx.recv().await {
            match msg {
                TarStreamMsg::Chunk(bytes, _) => {
                    compressed_data.extend_from_slice(&bytes);
                }
                TarStreamMsg::Done(stats) => {
                    final_stats = Some(stats);
                }
                TarStreamMsg::Err(err) => {
                    panic!("Error inesperado en tar stream: {}", err);
                }
            }
        }

        handle.await.unwrap();
        assert!(final_stats.is_some(), "Debe emitirse TarStreamMsg::Done");
        let stats = final_stats.unwrap();
        assert_eq!(stats.files_count, 1);

        let decoder = zstd::stream::read::Decoder::new(Cursor::new(compressed_data)).unwrap();
        let mut archive = tar::Archive::new(decoder);
        let entries: Vec<String> = archive
            .entries()
            .unwrap()
            .map(|e| {
                e.unwrap()
                    .path()
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect();

        assert!(
            entries
                .iter()
                .any(|e| e == "slot1" || e == "slot1/save.dat"),
            "Debe contener slot1/save.dat en formato relativo a la raíz: {:?}",
            entries
        );
    }

    #[tokio::test]
    async fn tar_stream_multi_paths_should_include_folder_prefixes() {
        let (root_a, _guard_a) = create_test_dir("multi_path_saves");
        let (root_b, _guard_b) = create_test_dir("multi_path_config");

        fs::write(root_a.join("slot.sav"), b"savegame data").unwrap();
        fs::write(root_b.join("settings.json"), b"{\"volume\": 100}").unwrap();

        let paths = vec![
            root_a.to_string_lossy().to_string(),
            root_b.to_string_lossy().to_string(),
        ];

        let (mut rx, handle) = spawn_tar_stream(paths, 8, 3);

        let mut compressed_data = Vec::new();
        let mut final_stats = None;

        while let Some(msg) = rx.recv().await {
            match msg {
                TarStreamMsg::Chunk(bytes, _) => {
                    compressed_data.extend_from_slice(&bytes);
                }
                TarStreamMsg::Done(stats) => {
                    final_stats = Some(stats);
                }
                TarStreamMsg::Err(err) => {
                    panic!("Error inesperado en tar stream: {}", err);
                }
            }
        }

        handle.await.unwrap();
        let stats = final_stats.expect("Debe completarse con éxito");
        assert_eq!(stats.files_count, 2);

        let decoder = zstd::stream::read::Decoder::new(Cursor::new(compressed_data)).unwrap();
        let mut archive = tar::Archive::new(decoder);
        let entries: Vec<String> = archive
            .entries()
            .unwrap()
            .map(|e| {
                e.unwrap()
                    .path()
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect();

        let has_save_file = entries.iter().any(|e| e.ends_with("slot.sav"));
        let has_config_file = entries.iter().any(|e| e.ends_with("settings.json"));

        assert!(
            has_save_file,
            "Debe contener el archivo de la ruta A: {:?}",
            entries
        );
        assert!(
            has_config_file,
            "Debe contener el archivo de la ruta B: {:?}",
            entries
        );
    }
}
