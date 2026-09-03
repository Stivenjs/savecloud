//! Motor de descarga acelerada multi-segmento en paralelo.
//!
//! Divide el archivo en 4 conexiones concurrentes con rangos HTTP (`Range: bytes=X-Y`),
//! sincronizando la escritura atómica directa a disco sin locks y persistiendo metadatos
//! en `.part.meta` para soportar pausa y reanudación exacta sin pérdidas.

use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::network::{apply_profile, DownloadProfile};
use super::io::{allocate_file_fast, write_at};

/// Número de conexiones concurrentes en descargas multi-segmento.
pub const NUM_PARALLEL_SEGMENTS: usize = 4;

/// Bytes descargados entre emisiones de progreso (evita saturar IPC/UI).
pub const HTTP_PROGRESS_EMIT_BYTES: u64 = 512 * 1024;

/// Intervalo mínimo entre emisiones de progreso.
pub const HTTP_PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(500);

/// Intervalo de persistencia en disco del archivo `.part.meta`.
const META_SAVE_INTERVAL: Duration = Duration::from_secs(2);

/// Estado de progreso de un segmento individual dentro del archivo completo.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct DownloadSegment {
    pub index: usize,
    pub start: u64,
    pub current: u64,
    pub end: u64,
}

/// Metadata serializada en `{nombre}.part.meta` para reanudar la descarga.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct DownloadMeta {
    pub total: u64,
    pub segments: Vec<DownloadSegment>,
}

/// Genera la partición inicial equilibrada en 4 rangos de bytes para un archivo de tamaño `total`.
pub fn create_default_segments(total: u64) -> Vec<DownloadSegment> {
    let seg_size = total / (NUM_PARALLEL_SEGMENTS as u64);
    let mut segments = Vec::with_capacity(NUM_PARALLEL_SEGMENTS);

    for i in 0..NUM_PARALLEL_SEGMENTS {
        let start = i as u64 * seg_size;
        let end = if i == NUM_PARALLEL_SEGMENTS - 1 {
            total.saturating_sub(1)
        } else {
            ((i as u64 + 1) * seg_size).saturating_sub(1)
        };
        segments.push(DownloadSegment {
            index: i,
            start,
            current: start,
            end,
        });
    }

    segments
}

/// Ejecuta la descarga en 4 conexiones paralelas concurrentes.
pub async fn run_multi_segment_download<F>(
    client: &reqwest::Client,
    effective_uri: &str,
    profile: &DownloadProfile,
    part_path: &Path,
    meta_path: &Path,
    total: u64,
    cancel_flag: Arc<AtomicBool>,
    pause_flag: Arc<AtomicBool>,
    mut emit_progress: F,
) -> Result<u64, String>
where
    F: FnMut(u64, u64, bool) -> Result<(), String>,
{
    let segments = if meta_path.exists() {
        match tokio::fs::read(meta_path).await {
            Ok(bytes) => match serde_json::from_slice::<DownloadMeta>(&bytes) {
                Ok(meta) if meta.total == total && meta.segments.len() == NUM_PARALLEL_SEGMENTS => {
                    meta.segments
                }
                _ => create_default_segments(total),
            },
            Err(_) => create_default_segments(total),
        }
    } else {
        create_default_segments(total)
    };

    let std_file = std::fs::OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(part_path)
        .map_err(|e| format!("No se pudo abrir archivo de descarga: {e}"))?;

    // Asignación ultra-rápida (instantánea vía sparse file en NTFS) sin congelar la app
    let _ = allocate_file_fast(&std_file, total);
    let file_arc = Arc::new(std_file);

    let initial_loaded: u64 = segments
        .iter()
        .map(|s| s.current.saturating_sub(s.start))
        .sum();
    let loaded_atomic = Arc::new(AtomicU64::new(initial_loaded));
    let segments_state = Arc::new(tokio::sync::Mutex::new(segments));

    let mut tasks = tokio::task::JoinSet::new();

    for seg_idx in 0..NUM_PARALLEL_SEGMENTS {
        let seg = {
            let guard = segments_state.lock().await;
            guard[seg_idx].clone()
        };

        if seg.current > seg.end {
            continue;
        }

        let client = client.clone();
        let uri = effective_uri.to_string();
        let profile = profile.clone();
        let file_arc = Arc::clone(&file_arc);
        let loaded_atomic = Arc::clone(&loaded_atomic);
        let segments_state = Arc::clone(&segments_state);
        let cancel_flag = Arc::clone(&cancel_flag);
        let pause_flag = Arc::clone(&pause_flag);

        tasks.spawn(async move {
            let start = seg.current;
            let end = seg.end;
            let range = format!("bytes={start}-{end}");
            let req = client.get(&uri).header("Range", range);
            let req = apply_profile(req, &profile);
            let res = req
                .send()
                .await
                .map_err(|e| format!("Error conectando segmento {seg_idx}: {e}"))?;

            if !res.status().is_success() && res.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                return Err(format!(
                    "El servidor rechazó rango HTTP en segmento {seg_idx} (código {})",
                    res.status()
                ));
            }

            let mut stream = res.bytes_stream();
            let mut curr = start;

            while let Some(chunk_res) = stream.next().await {
                if cancel_flag.load(Ordering::Relaxed) || pause_flag.load(Ordering::Relaxed) {
                    break;
                }

                let chunk = chunk_res
                    .map_err(|e| format!("Error en stream del segmento {seg_idx}: {e}"))?;
                write_at(&file_arc, &chunk, curr)
                    .map_err(|e| format!("Error de disco en segmento {seg_idx}: {e}"))?;

                let chunk_len = chunk.len() as u64;
                curr += chunk_len;
                loaded_atomic.fetch_add(chunk_len, Ordering::Relaxed);

                if let Ok(mut guard) = segments_state.try_lock() {
                    guard[seg_idx].current = curr;
                }
            }

            {
                let mut guard = segments_state.lock().await;
                guard[seg_idx].current = curr;
            }

            Ok::<(), String>(())
        });
    }

    let mut last_save = Instant::now();
    let mut last_emit_loaded = initial_loaded;
    let mut last_emit_at = Instant::now();

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            tasks.abort_all();
            let _ = tokio::fs::remove_file(part_path).await;
            let _ = tokio::fs::remove_file(meta_path).await;
            return Err("stopped_by_user".to_string());
        }

        if pause_flag.load(Ordering::Relaxed) {
            tasks.abort_all();
            let guard = segments_state.lock().await;
            let meta = DownloadMeta {
                total,
                segments: guard.clone(),
            };
            if let Ok(bytes) = serde_json::to_vec(&meta) {
                let _ = tokio::fs::write(meta_path, bytes).await;
            }
            return Err("paused_by_user".to_string());
        }

        let current_loaded = loaded_atomic.load(Ordering::Relaxed);
        let bytes_step =
            current_loaded.saturating_sub(last_emit_loaded) >= HTTP_PROGRESS_EMIT_BYTES;
        let time_step = last_emit_at.elapsed() >= HTTP_PROGRESS_EMIT_INTERVAL;
        let reached_end = current_loaded >= total;

        if (bytes_step && time_step) || reached_end {
            emit_progress(current_loaded, total, false)?;
            last_emit_loaded = current_loaded;
            last_emit_at = Instant::now();
        }

        if last_save.elapsed() >= META_SAVE_INTERVAL {
            if let Ok(guard) = segments_state.try_lock() {
                let meta = DownloadMeta {
                    total,
                    segments: guard.clone(),
                };
                if let Ok(bytes) = serde_json::to_vec(&meta) {
                    let _ = tokio::fs::write(meta_path, bytes).await;
                }
            }
            last_save = Instant::now();
        }

        if tasks.is_empty() || reached_end {
            break;
        }

        tokio::select! {
            Some(res) = tasks.join_next() => {
                match res {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => {
                        tasks.abort_all();
                        return Err(e);
                    }
                    Err(e) if !e.is_cancelled() => {
                        tasks.abort_all();
                        return Err(format!("Fallo en tarea de segmento: {e}"));
                    }
                    _ => {}
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(100)) => {}
        }
    }

    let final_loaded = loaded_atomic.load(Ordering::Relaxed);
    emit_progress(final_loaded, total, true)?;
    let _ = tokio::fs::remove_file(meta_path).await;
    drop(file_arc);
    Ok(final_loaded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_default_segments_partitions_contiguous_ranges() {
        let total: u64 = 1000;
        let segs = create_default_segments(total);

        assert_eq!(segs.len(), 4);
        assert_eq!(segs[0].start, 0);
        assert_eq!(segs[0].end, 249);

        assert_eq!(segs[1].start, 250);
        assert_eq!(segs[1].end, 499);

        assert_eq!(segs[2].start, 500);
        assert_eq!(segs[2].end, 749);

        assert_eq!(segs[3].start, 750);
        assert_eq!(segs[3].end, 999);
    }

    #[test]
    fn create_default_segments_handles_arbitrary_file_sizes() {
        let total: u64 = 9_741_572_403; // Left 4 Dead 2 size
        let segs = create_default_segments(total);

        assert_eq!(segs.len(), 4);
        assert_eq!(segs[0].start, 0);
        assert_eq!(segs[3].end, total - 1);

        for i in 0..3 {
            assert_eq!(segs[i].end + 1, segs[i + 1].start);
        }
    }
}
