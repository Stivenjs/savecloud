//! Streaming de directorios como archivos TAR comprimidos con ZSTD hacia un canal de chunks.
//!
//! Este módulo integra `tar-rs` con `zstd` y un `tokio::sync::mpsc` para producir un
//! flujo de chunks (`bytes::Bytes`) comprimidos a medida que se genera el archivo,
//! evitando almacenamiento intermedio en disco.
//!
//! La generación del TAR y la compresión se ejecutan en un hilo blocking mediante
//! [`tokio::task::spawn_blocking`]. Los datos comprimidos se escriben en un
//! [`ChannelWriter`], que implementa [`std::io::Write`] y se encarga de
//! fragmentarlos en chunks de tamaño fijo antes de enviarlos al canal.
//!
//! El consumidor recibe una secuencia de [`TarStreamMsg`] que representa:
//!
//! - [`TarStreamMsg::Chunk`]: datos del archivo comprimido en orden de generación.
//! - [`TarStreamMsg::Done`]: finalización correcta del stream.
//! - [`TarStreamMsg::Err`]: fallo durante el empaquetado, compresión o envío.
//!
//! El canal actúa como mecanismo de backpressure, limitando la producción
//! según su capacidad configurada e impidiendo que la compresión llene la RAM.

use std::io::{self, Write};
use std::path::{Path, PathBuf};

use bytes::{BufMut, BytesMut};
use walkdir::WalkDir;

use super::upload_strategy::TAR_STREAM_CHUNK_BYTES;

/// Mensajes que el hilo TAR envía al consumidor async.
#[derive(Debug)]
pub(crate) enum TarStreamMsg {
    /// Chunk de bytes comprimidos listos para subir.
    /// Incluye la cantidad total de bytes originales [`TAR_STREAM_CHUNK_BYTES`] (sin comprimir) procesados hasta ahora
    /// para que el contador de progreso sea exacto.
    Chunk(bytes::Bytes, u64),
    /// El archivo se generó y comprimió totalmente; todos los bytes fueron enviados.
    Done,
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
/// Usa un pipeline manual con `walkdir` en lugar de `append_dir_all` para tener
/// control fino sobre el flujo de archivos y puntos de backpressure entre entradas.
///
/// # Parameters
///
/// - `source_dir`: directorio raíz a empaquetar. Se toma posesión para `'static`.
/// - `channel_capacity`: capacidad del canal mpsc. Debe ser `strategy.tar_channel_capacity`.
///
/// # Return
///
/// `(Receiver<TarStreamMsg>, JoinHandle<()>)`. El canal se cierra con
/// [`TarStreamMsg::Done`] en el camino feliz o [`TarStreamMsg::Err`] ante fallo.
pub(crate) fn spawn_tar_stream(
    source_dir: PathBuf,
    channel_capacity: usize,
    zstd_compression_level: i32,
) -> (
    tokio::sync::mpsc::Receiver<TarStreamMsg>,
    tokio::task::JoinHandle<()>,
) {
    let (tx, rx) = tokio::sync::mpsc::channel::<TarStreamMsg>(channel_capacity);

    let handle = tokio::task::spawn_blocking(move || {
        match run_tar_pipeline(&source_dir, tx.clone(), zstd_compression_level) {
            Ok(()) => {
                let _ = tx.blocking_send(TarStreamMsg::Done);
            }
            Err(e) => {
                let _ = tx.blocking_send(TarStreamMsg::Err(e));
            }
        }
        // `tx` se dropea aquí, cerrando el canal desde el lado productor.
    });

    (rx, handle)
}

/// Empaqueta `source_dir` en formato TAR mediante un pipeline manual con `walkdir`.
///
/// En vez de delegar el recorrido a `append_dir_all`, itera explícitamente sobre
/// las entradas del directorio y llama a `append_file` o `append_dir` según el tipo
/// de cada entrada. Esto permite:
///
/// - Registrar por separado en el log cada archivo procesado (útil para diagnóstico).
/// - Introducir puntos de backpressure entre archivos sin bloquear en mitad de uno.
/// - Manejar errores por entrada individualmente sin abortar todo el TAR.
///
/// Los symlinks se preservan como entradas TAR de tipo enlace simbólico en vez de
/// seguirlos, reduciendo el tamaño del TAR en directorios con muchos enlaces.
fn run_tar_pipeline(
    source_dir: &Path,
    tx: tokio::sync::mpsc::Sender<TarStreamMsg>,
    zstd_compression_level: i32,
) -> Result<(), String> {
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
        counter: original_counter,
    };

    let mut builder = tar::Builder::new(progress_writer);
    builder.follow_symlinks(false);

    // `WalkDir` itera en orden DFS. `min_depth(0)` incluye el directorio raíz
    // como primera entrada, necesario para que el TAR tenga la entrada de directorio
    // antes que sus contenidos (comportamiento equivalente a `append_dir_all`).
    let walker = WalkDir::new(source_dir)
        .follow_links(false)
        .same_file_system(true) // evitar cruzar puntos de montaje (ej. particiones distintas)
        .into_iter();

    for entry_result in walker {
        let entry = entry_result.map_err(|e| format!("error recorriendo directorio: {}", e))?;

        // Ruta relativa a la raíz del TAR. `strip_prefix` elimina el prefijo del
        // directorio fuente, dejando solo la ruta dentro del archivo TAR.
        let relative = entry
            .path()
            .strip_prefix(source_dir)
            .map_err(|e| format!("error calculando ruta relativa: {}", e))?;

        // Saltar la entrada raíz "." para evitar una entrada de directorio vacía
        // al inicio del TAR que algunos extractores interpretan de forma distinta.
        if relative == Path::new("") || relative == Path::new(".") {
            continue;
        }

        let file_type = entry.file_type();

        if file_type.is_dir() {
            // Las entradas de directorio solo escriben la cabecera TAR (512 bytes).
            // No hay datos que leer del disco, así que el backpressure solo aplica
            // cuando el buffer del `ChannelWriter` se llena con muchas cabeceras.
            builder
                .append_dir(relative, entry.path())
                .map_err(|e| format!("error empaquetando dir '{}': {}", relative.display(), e))?;
        } else if file_type.is_file() {
            // `append_path_with_name` lee el archivo desde la ruta del sistema de
            // archivos y lo escribe en el TAR con la ruta relativa calculada arriba.
            // Esta es la operación costosa en I/O: lee el archivo en bloques y los
            // pasa a `ChannelWriter::write`, que aplica backpressure si el canal está lleno.
            let mut file = std::fs::File::open(entry.path())
                .map_err(|e| format!("error abriendo '{}': {}", entry.path().display(), e))?;

            builder
                .append_file(relative, &mut file)
                .map_err(|e| format!("error empaquetando '{}': {}", relative.display(), e))?;
        } else if file_type.is_symlink() {
            // Los symlinks se preservan usando `append_path` con `follow_symlinks(false)`.
            // `tar-rs` leerá el destino del enlace con `std::fs::read_link` y escribirá
            // una cabecera TAR de tipo enlace simbólico sin leer el archivo destino.
            builder
                .append_path_with_name(entry.path(), relative)
                .map_err(|e| {
                    format!("error empaquetando symlink '{}': {}", relative.display(), e)
                })?;
        }
        // Otros tipos (sockets, devices) se omiten silenciosamente: no tienen
        // representación significativa en un backup de saves de juego.
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

    Ok(())
}
