use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// Tamaño mínimo sugerido del chunk. Si el crate tar envía un bloque más grande,
/// se envía completo para evitar copias en memoria.
const TAR_STREAM_CHUNK_BYTES: usize = 256 * 1024;

#[derive(Debug)]
pub(crate) enum TarStreamMsg {
    Chunk(Vec<u8>),
    Done,
    Err(String),
}

struct ChannelWriter {
    tx: tokio::sync::mpsc::Sender<TarStreamMsg>,
    buf: Vec<u8>,
}

impl ChannelWriter {
    fn new(tx: tokio::sync::mpsc::Sender<TarStreamMsg>) -> Self {
        Self {
            tx,
            buf: Vec::with_capacity(TAR_STREAM_CHUNK_BYTES),
        }
    }

    /// Vacía todo el contenido actual del buffer al canal
    fn flush_all(&mut self) -> io::Result<()> {
        if !self.buf.is_empty() {
            // std::mem::take cambia el contenido del buffer por uno vacío instantáneamente
            let chunk = std::mem::take(&mut self.buf);
            self.tx
                .blocking_send(TarStreamMsg::Chunk(chunk))
                .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "receiver dropped"))?;
        }
        Ok(())
    }
}

impl Write for ChannelWriter {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        // Fast Path: Si el buffer está vacío y el dato entrante es grande,
        // lo enviamos directamente al canal sin copiarlo al buffer interno.
        if self.buf.is_empty() && data.len() >= TAR_STREAM_CHUNK_BYTES {
            self.tx
                .blocking_send(TarStreamMsg::Chunk(data.to_vec()))
                .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "receiver dropped"))?;
            return Ok(data.len());
        }

        self.buf.extend_from_slice(data);

        // Si el buffer superó el umbral, enviamos todo su contenido de golpe (O(1)).
        // El receptor (multipart) ya se encarga de sumar y agrupar todo en bloques de 32MB.
        if self.buf.len() >= TAR_STREAM_CHUNK_BYTES {
            let chunk = std::mem::take(&mut self.buf);
            // Pre-reservamos memoria para evitar reubicaciones en el siguiente ciclo
            self.buf.reserve(TAR_STREAM_CHUNK_BYTES);

            self.tx
                .blocking_send(TarStreamMsg::Chunk(chunk))
                .map_err(|_| io::Error::new(io::ErrorKind::BrokenPipe, "receiver dropped"))?;
        }

        Ok(data.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.flush_all()
    }
}

/// Spawnea la creación del TAR en un hilo blocking y devuelve un stream de bytes.
///
/// El TAR contiene el contenido de `source_dir` bajo el path raíz `"."`.
pub(crate) fn spawn_tar_stream(
    source_dir: PathBuf,
    channel_capacity: usize,
) -> (
    tokio::sync::mpsc::Receiver<TarStreamMsg>,
    tokio::task::JoinHandle<()>,
) {
    let (tx, rx) = tokio::sync::mpsc::channel::<TarStreamMsg>(channel_capacity);
    let handle = tokio::task::spawn_blocking(move || {
        if let Err(e) = run_tar_to_channel(&source_dir, tx.clone()) {
            let _ = tx.blocking_send(TarStreamMsg::Err(e));
        }
        // Asegurar un cierre explícito para que el receiver pueda terminar.
        let _ = tx.blocking_send(TarStreamMsg::Done);
    });
    (rx, handle)
}

fn run_tar_to_channel(
    source_dir: &Path,
    tx: tokio::sync::mpsc::Sender<TarStreamMsg>,
) -> Result<(), String> {
    let writer = ChannelWriter::new(tx);
    let mut builder = tar::Builder::new(writer);

    builder
        .append_dir_all(".", source_dir)
        .map_err(|e| format!("Error empaquetando dir: {}", e))?;

    // Recuperamos el writer (into_inner llama a finish internamente)
    // y forzamos el volcado de los últimos bytes.
    let mut inner_writer = builder
        .into_inner()
        .map_err(|e| format!("Error finalizando tar: {}", e))?;

    inner_writer
        .flush_all()
        .map_err(|e| format!("Error vaciando buffer final: {}", e))?;

    Ok(())
}
