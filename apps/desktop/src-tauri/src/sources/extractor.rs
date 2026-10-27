//! Extracción de archivos comprimidos descargados (ZIP, RAR, 7z, TAR y variantes).
//!
//! - **ZIP**: extracción paralela con `rayon` (un `ZipArchive` por hilo de trabajo).
//! - **7z / RAR / TAR**: se delega en herramientas del sistema, reportando progreso
//!   en bytes del archivo comprimido.
//!
//! La API pública (`is_archive`, `extract_zip`, `extract_archive` y
//! `process_post_download_extraction`) conserva nombres y firmas.

use super::domain::SourceJobStatus;
use super::events::{emit_progress, emit_terminal};
use super::queue::{find_job, now_iso, spawn_inventory_rescan_after_download, SourcesState};
use rayon::prelude::*;
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf, MAIN_SEPARATOR};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use crate::utils::transfer_metrics::{TransferSample, TransferSpeedTracker};

// Constantes

/// Tamaño del buffer de copia/lectura (512 KiB).
const COPY_BUF_SIZE: usize = 512 * 1024;

/// Intervalo mínimo entre dos actualizaciones de progreso.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

/// Máximo de hilos para extraer un ZIP. Limitarlo evita saturar discos HDD y antivirus.
const MAX_ZIP_WORKERS: usize = 8;

/// Entradas mínimas por trozo de trabajo. Evita reabrir el ZIP (y reparsear su
/// directorio central) demasiadas veces.
const MIN_ZIP_ENTRIES_PER_WORKER: usize = 16;

/// Flag de Windows para no mostrar una ventana de consola al lanzar procesos.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// Detección de herramientas del sistema

/// Herramientas externas de extracción disponibles en el sistema.
struct SystemTools {
    has_7z: bool,
    has_unrar: bool,
    has_tar: bool,
}

static SYSTEM_TOOLS: OnceLock<SystemTools> = OnceLock::new();

/// Crea un `Command` listo para usarse desde una app gráfica.
///
/// En Windows suprime la ventana de consola que aparecería al lanzar el proceso.
fn new_command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Comprueba si un programa puede ejecutarse (basta con que el proceso arranque).
fn is_tool_available(program: &str, args: &[&str]) -> bool {
    new_command(program)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok()
}

/// Devuelve las herramientas disponibles. La detección se hace una sola vez.
fn system_tools() -> &'static SystemTools {
    SYSTEM_TOOLS.get_or_init(|| SystemTools {
        has_7z: is_tool_available("7z", &["i"]),
        has_unrar: is_tool_available("unrar", &[]),
        has_tar: is_tool_available("tar", &["--version"]),
    })
}

// Clasificación de archivos

/// Familia de formato, usada para elegir la herramienta de extracción.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArchiveKind {
    Zip,
    Rar,
    /// `.tar`, `.tar.gz`, `.tgz`, `.tar.zst`
    Tar,
    /// `.7z`, `.gz`, `.zst` y cualquier otro formato soportado.
    Other,
}

impl ArchiveKind {
    /// Deduce la familia a partir del nombre del archivo (sin distinguir mayúsculas).
    fn from_path(path: &Path) -> Self {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();

        if name.ends_with(".zip") {
            Self::Zip
        } else if name.ends_with(".rar") {
            Self::Rar
        } else if name.ends_with(".tar")
            || name.ends_with(".tgz")
            || name.ends_with(".tar.gz")
            || name.ends_with(".tar.zst")
        {
            Self::Tar
        } else {
            Self::Other
        }
    }
}

/// Indica si un nombre de archivo corresponde a un formato comprimido soportado.
///
/// # Argumentos
/// * `filename` - Nombre del archivo (con extensión).
///
/// # Ejemplos
/// ```ignore
/// assert!(is_archive("juego.7z"));
/// assert!(is_archive("datos.TAR.GZ")); // la extensión final es `gz`
/// assert!(!is_archive("video.mp4"));
/// ```
pub fn is_archive(filename: &str) -> bool {
    // `.tar.gz` y `.tar.zst` quedan cubiertos por su extensión final (`gz` / `zst`).
    matches!(
        filename
            .to_lowercase()
            .rsplit_once('.')
            .map(|(_, ext)| ext.to_owned())
            .as_deref(),
        Some("zip" | "rar" | "7z" | "tar" | "tgz" | "gz" | "zst")
    )
}

// Reporte de progreso

/// Marca el job como `Extracting` y emite el progreso sin datos de velocidad/ETA.
///
/// # Argumentos
/// * `loaded` - Unidades procesadas.
/// * `total` - Unidades totales.
#[inline]
fn push_progress(app: &AppHandle, state: &SourcesState, job_id: &str, loaded: u64, total: u64) {
    push_progress_sample(
        app,
        state,
        job_id,
        loaded,
        total,
        TransferSample {
            download_speed_bytes: 0,
            eta_seconds: None,
        },
    );
}

/// Persiste y emite el progreso del job incluyendo velocidad y ETA.
fn push_progress_sample(
    app: &AppHandle,
    state: &SourcesState,
    job_id: &str,
    loaded: u64,
    total: u64,
    sample: TransferSample,
) {
    if let Ok(mut job) = find_job(state, job_id) {
        job.status = SourceJobStatus::Extracting;
        job.loaded = loaded;
        job.total = total;
        job.download_speed_bytes = sample.download_speed_bytes;
        job.eta_seconds = sample.eta_seconds;
        job.updated_at = now_iso();
        let _ = state.upsert_job(job.clone());
        emit_progress(app, &job);
    }
}

/// Calcula velocidad/ETA con el `tracker` y emite el progreso.
///
/// # Argumentos
/// * `is_final` - `true` para la muestra final (cierra las métricas del tracker).
fn push_zip_progress(
    app: &AppHandle,
    state: &SourcesState,
    job_id: &str,
    loaded: u64,
    total: u64,
    tracker: &mut TransferSpeedTracker,
    is_final: bool,
) {
    let now = Instant::now();
    let sample = if is_final {
        tracker.record_final(loaded, total, now)
    } else {
        tracker.record(loaded, total, now)
    };
    push_progress_sample(app, state, job_id, loaded, total, sample);
}

/// Emisor de progreso con *throttle* y métricas de velocidad integradas.
///
/// Encapsula lo que antes se repetía en cada extractor: `last_update`,
/// el intervalo mínimo y el `TransferSpeedTracker`.
struct ProgressReporter<'a> {
    app: &'a AppHandle,
    state: &'a SourcesState,
    job_id: &'a str,
    tracker: TransferSpeedTracker,
    last_update: Instant,
}

impl<'a> ProgressReporter<'a> {
    /// Crea un reporter para el job indicado.
    fn new(app: &'a AppHandle, state: &'a SourcesState, job_id: &'a str) -> Self {
        Self {
            app,
            state,
            job_id,
            tracker: TransferSpeedTracker::new(),
            last_update: Instant::now(),
        }
    }

    /// Emite progreso solo si pasó `PROGRESS_INTERVAL` desde la última emisión.
    fn report(&mut self, loaded: u64, total: u64) {
        if self.last_update.elapsed() >= PROGRESS_INTERVAL {
            self.report_now(loaded, total);
        }
    }

    /// Emite progreso inmediatamente, ignorando el throttle.
    fn report_now(&mut self, loaded: u64, total: u64) {
        self.last_update = Instant::now();
        push_zip_progress(
            self.app,
            self.state,
            self.job_id,
            loaded,
            total,
            &mut self.tracker,
            false,
        );
    }

    /// Emite el 100 % como muestra final.
    fn finish(&mut self, total: u64) {
        push_zip_progress(
            self.app,
            self.state,
            self.job_id,
            total,
            total,
            &mut self.tracker,
            true,
        );
    }
}

// ZIP (paralelo)

/// Contexto de un hilo de trabajo ZIP: su propio lector y buffer.
///
/// Cada hilo necesita su propio `ZipArchive` porque `by_index` requiere `&mut`.
struct ZipWorker {
    archive: zip::ZipArchive<File>,
    buffer: Vec<u8>,
}

impl ZipWorker {
    /// Abre el ZIP de forma independiente para este hilo.
    fn open(archive_path: &Path) -> Result<Self, String> {
        let file = File::open(archive_path).map_err(|e| format!("No se pudo abrir ZIP: {e}"))?;
        let archive =
            zip::ZipArchive::new(file).map_err(|e| format!("Formato ZIP inválido: {e}"))?;
        Ok(Self {
            archive,
            buffer: vec![0u8; COPY_BUF_SIZE],
        })
    }
}

/// Lee el número de entradas y el tamaño total descomprimido de un ZIP.
///
/// El tamaño se obtiene del directorio central (`by_index_raw`), sin descomprimir.
fn read_zip_summary(archive_path: &Path) -> Result<(usize, u64), String> {
    let file = File::open(archive_path).map_err(|e| format!("No se pudo abrir ZIP: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Formato ZIP inválido: {e}"))?;

    let total_files = archive.len();
    let total_uncompressed: u64 = (0..total_files)
        .filter_map(|i| archive.by_index_raw(i).ok().map(|f| f.size()))
        .fold(0u64, |acc, size| acc.saturating_add(size));

    Ok((total_files, total_uncompressed.max(1)))
}

/// Número de hilos a usar: núcleos disponibles, acotado por `MAX_ZIP_WORKERS`.
fn zip_worker_count() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
        .clamp(1, MAX_ZIP_WORKERS)
}

/// Extrae una sola entrada del ZIP al disco.
///
/// Las entradas con ruta insegura (`enclosed_name() == None`, p. ej. `../`) se omiten.
///
/// # Argumentos
/// * `extracted` - Contador compartido de bytes escritos (alimenta el progreso).
fn extract_zip_entry(
    worker: &mut ZipWorker,
    index: usize,
    destination_dir: &Path,
    extracted: &AtomicU64,
) -> Result<(), String> {
    let mut entry = worker
        .archive
        .by_index(index)
        .map_err(|e| format!("Error leyendo entrada {index}: {e}"))?;

    let Some(relative_path) = entry.enclosed_name() else {
        return Ok(());
    };
    let out_path = destination_dir.join(relative_path);

    if entry.is_dir() {
        return std::fs::create_dir_all(&out_path)
            .map_err(|e| format!("No se pudo crear directorio: {e}"));
    }

    if let Some(parent) = out_path.parent() {
        // `create_dir_all` es seguro ante condiciones de carrera entre hilos.
        std::fs::create_dir_all(parent).map_err(|e| format!("No se pudo crear padre: {e}"))?;
    }

    let mut out_file = File::create(&out_path)
        .map_err(|e| format!("No se pudo crear {}: {e}", out_path.display()))?;
    // Preasigna espacio para reducir la fragmentación; es solo una optimización.
    let _ = out_file.set_len(entry.size());

    // Se escriben bloques de 512 KiB directamente: un `BufWriter` solo añadiría una copia.
    loop {
        let read = entry
            .read(&mut worker.buffer)
            .map_err(|e| format!("Error leyendo ZIP entrada: {e}"))?;
        if read == 0 {
            break;
        }
        out_file
            .write_all(&worker.buffer[..read])
            .map_err(|e| format!("Error escribiendo {}: {e}", out_path.display()))?;
        extracted.fetch_add(read as u64, Ordering::Relaxed);
    }

    Ok(())
}

/// Reparte las entradas del ZIP entre un pool de hilos acotado.
///
/// Se detiene en el primer error.
fn extract_zip_entries_parallel(
    archive_path: &Path,
    destination_dir: &Path,
    total_files: usize,
    extracted: &AtomicU64,
) -> Result<(), String> {
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(zip_worker_count())
        .build()
        .map_err(|e| format!("No se pudo crear el pool de extracción: {e}"))?;

    pool.install(|| {
        (0..total_files)
            .into_par_iter()
            .with_min_len(MIN_ZIP_ENTRIES_PER_WORKER)
            .try_for_each_init(
                || ZipWorker::open(archive_path),
                |worker, index| {
                    let worker = worker.as_mut().map_err(|e| e.clone())?;
                    extract_zip_entry(worker, index, destination_dir, extracted)
                },
            )
    })
}

/// Extrae un ZIP en paralelo reportando progreso por bytes descomprimidos.
///
/// # Argumentos
/// * `app` - Handle de Tauri (estado y eventos).
/// * `job_id` - Identificador del job cuyo progreso se actualiza.
/// * `archive_path` - Ruta del `.zip`.
/// * `destination_dir` - Directorio destino (se crea si no existe).
///
/// # Errores
/// Devuelve un mensaje descriptivo si el ZIP es inválido o falla alguna lectura/escritura.
pub fn extract_zip(
    app: &AppHandle,
    job_id: &str,
    archive_path: &Path,
    destination_dir: &Path,
) -> Result<(), String> {
    let state = app.state::<SourcesState>();
    push_progress(app, &state, job_id, 0, 0);

    let (total_files, total_uncompressed) = read_zip_summary(archive_path)?;
    if total_files == 0 {
        return Ok(());
    }

    std::fs::create_dir_all(destination_dir)
        .map_err(|e| format!("No se pudo crear directorio destino: {e}"))?;

    let extracted = AtomicU64::new(0);
    let (stop_tx, stop_rx) = mpsc::channel::<()>();

    let (result, mut reporter) = std::thread::scope(|scope| {
        let state_ref: &SourcesState = &state;
        let extracted_ref = &extracted;

        // Hilo dedicado al progreso: despierta cada 250 ms o al recibir la señal de parada.
        let reporter_thread = scope.spawn(move || {
            let mut reporter = ProgressReporter::new(app, state_ref, job_id);
            while let Err(RecvTimeoutError::Timeout) = stop_rx.recv_timeout(PROGRESS_INTERVAL) {
                let loaded = extracted_ref.load(Ordering::Relaxed).min(total_uncompressed);
                reporter.report_now(loaded, total_uncompressed);
            }
            reporter
        });

        let result =
            extract_zip_entries_parallel(archive_path, destination_dir, total_files, &extracted);

        // Cerrar el canal despierta al hilo de progreso de inmediato.
        drop(stop_tx);
        let reporter = reporter_thread
            .join()
            .expect("el hilo de progreso de extracción entró en pánico");

        (result, reporter)
    });

    result?;
    reporter.finish(total_uncompressed);
    Ok(())
}

// 7z

/// Extrae un porcentaje (`"42%"`) de un fragmento de salida de 7z.
fn parse_percent(segment: &[u8]) -> Option<u64> {
    String::from_utf8_lossy(segment)
        .split_whitespace()
        .find_map(|token| token.strip_suffix('%')?.parse::<u64>().ok())
}

/// Extrae con `7z`, convirtiendo su porcentaje en bytes del archivo comprimido.
///
/// 7z reescribe la línea de progreso usando `\r` (no `\n`), por eso se lee por
/// segmentos delimitados por `\r` en lugar de `lines()`.
fn extract_7z(
    app: &AppHandle,
    job_id: &str,
    archive_path: &Path,
    destination_dir: &Path,
) -> Result<(), String> {
    let archive_size = archive_path.metadata().map(|m| m.len()).unwrap_or(1).max(1);
    let state = app.state::<SourcesState>();
    push_progress(app, &state, job_id, 0, archive_size);

    let mut child = new_command("7z")
        .args([
            "x",
            "-bsp1",
            "-bso0",
            "-mmt=on",
            archive_path.to_string_lossy().as_ref(),
            &format!("-o{}", destination_dir.to_string_lossy()),
            "-y",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar 7z: {e}"))?;

    let stdout = child.stdout.take().ok_or("No stdout de 7z")?;
    let mut reporter = ProgressReporter::new(app, &state, job_id);

    for segment in BufReader::new(stdout).split(b'\r').map_while(Result::ok) {
        if let Some(percent) = parse_percent(&segment) {
            let loaded = percent.min(100) * archive_size / 100;
            reporter.report(loaded, archive_size);
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Error esperando 7z: {e}"))?;
    if !status.success() {
        return Err("7z falló durante la extracción".into());
    }

    reporter.finish(archive_size);
    Ok(())
}

// RAR

/// Cuenta las entradas de un RAR con `unrar lb` (listado simple, una por línea).
///
/// Devuelve al menos 1 para poder usarlo como divisor.
fn count_rar_entries(archive_path: &Path) -> u64 {
    new_command("unrar")
        .args(["lb", "-p-"])
        .arg(archive_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map(|output| output.stdout.split(|&b| b == b'\n').filter(|l| !l.is_empty()).count() as u64)
        .unwrap_or(0)
        .max(1)
}

/// Extrae con `unrar`. El progreso se estima como proporción de entradas extraídas.
///
/// `unrar` escribe `Extracting ...` por **stdout**; se lee ese canal y se usa `-idp`
/// para desactivar su indicador de porcentaje, que ensucia la salida.
fn extract_unrar(
    app: &AppHandle,
    job_id: &str,
    archive_path: &Path,
    destination_dir: &Path,
) -> Result<(), String> {
    let archive_size = archive_path.metadata().map(|m| m.len()).unwrap_or(1).max(1);
    let state = app.state::<SourcesState>();
    push_progress(app, &state, job_id, 0, archive_size);

    std::fs::create_dir_all(destination_dir)
        .map_err(|e| format!("No se pudo crear directorio destino: {e}"))?;

    let total_entries = count_rar_entries(archive_path);

    // `unrar` exige que el destino termine en separador de ruta.
    let mut destination = destination_dir.to_string_lossy().into_owned();
    if !destination.ends_with(MAIN_SEPARATOR) {
        destination.push(MAIN_SEPARATOR);
    }

    let mut child = new_command("unrar")
        .args(["x", "-p-", "-y", "-idp"])
        .arg(archive_path)
        .arg(&destination)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar unrar: {e}"))?;

    let stdout = child.stdout.take().ok_or("No stdout de unrar")?;
    let mut reporter = ProgressReporter::new(app, &state, job_id);
    let mut extracted_entries: u64 = 0;

    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if line.trim_start().starts_with("Extracting") {
            extracted_entries += 1;
            let loaded = archive_size * extracted_entries.min(total_entries) / total_entries;
            reporter.report(loaded, archive_size);
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Error esperando unrar: {e}"))?;
    if !status.success() {
        return Err("unrar falló durante la extracción".into());
    }

    reporter.finish(archive_size);
    Ok(())
}

// TAR (.tar, .tar.gz, .tgz, .tar.zst)

/// Alimenta la entrada estándar de `tar` con el archivo, informando bytes enviados.
///
/// Como `tar` consume por tubería, los bytes enviados equivalen al avance real sobre
/// el archivo **comprimido**, lo que da un porcentaje exacto incluso en `.tar.gz`
/// (el método anterior por `--checkpoint` medía bytes descomprimidos).
///
/// Si `tar` cierra la tubería antes de tiempo se corta sin error: el fallo real
/// se reporta con su código de salida.
fn pipe_archive_to_tar(
    mut input: File,
    mut tar_stdin: impl Write,
    archive_size: u64,
    reporter: &mut ProgressReporter,
) -> std::io::Result<()> {
    let mut buffer = vec![0u8; COPY_BUF_SIZE];
    let mut sent: u64 = 0;

    loop {
        let read = input.read(&mut buffer)?;
        if read == 0 {
            return Ok(());
        }
        if tar_stdin.write_all(&buffer[..read]).is_err() {
            return Ok(());
        }
        sent += read as u64;
        reporter.report(sent.min(archive_size), archive_size);
    }
}

/// Extrae con `tar` leyendo el archivo por stdin (`-xf -`).
///
/// `tar` detecta la compresión (gzip, zstd) automáticamente; para `.tar.zst` debe
/// existir `zstd` en el sistema.
fn extract_tar(
    app: &AppHandle,
    job_id: &str,
    archive_path: &Path,
    destination_dir: &Path,
) -> Result<(), String> {
    let archive_size = archive_path.metadata().map(|m| m.len()).unwrap_or(1).max(1);
    let state = app.state::<SourcesState>();
    push_progress(app, &state, job_id, 0, archive_size);

    std::fs::create_dir_all(destination_dir)
        .map_err(|e| format!("No se pudo crear directorio destino: {e}"))?;

    let input = File::open(archive_path).map_err(|e| format!("No se pudo abrir archivo: {e}"))?;

    let mut child = new_command("tar")
        .args(["-x", "-C"])
        .arg(destination_dir)
        .args(["-f", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar tar: {e}"))?;

    let tar_stdin = child.stdin.take().ok_or("No stdin de tar")?;
    let mut reporter = ProgressReporter::new(app, &state, job_id);

    if let Err(error) = pipe_archive_to_tar(input, tar_stdin, archive_size, &mut reporter) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("Error leyendo archivo para tar: {error}"));
    }
    // `tar_stdin` se liberó dentro de `pipe_archive_to_tar`: tar ve EOF y termina.

    let status = child
        .wait()
        .map_err(|e| format!("Error esperando tar: {e}"))?;
    if !status.success() {
        return Err("tar falló durante la extracción".into());
    }

    reporter.finish(archive_size);
    Ok(())
}

// Despacho

/// Extrae un archivo eligiendo automáticamente la mejor herramienta disponible.
///
/// Orden de preferencia:
/// 1. ZIP → extractor nativo paralelo.
/// 2. RAR → `unrar` (más rápido que 7z), con `7z` como respaldo.
/// 3. TAR/TGZ/TAR.ZST → `tar` (descomprime y desempaqueta en un paso), con `7z` de respaldo.
/// 4. Resto → `7z`, con `tar` como último recurso.
///
/// # Argumentos
/// * `app` - Handle de Tauri.
/// * `job_id` - Identificador del job.
/// * `archive_path` - Archivo a extraer.
/// * `destination_dir` - Carpeta de destino.
///
/// # Errores
/// Error si no hay ninguna herramienta compatible o si la extracción falla.
pub fn extract_archive(
    app: &AppHandle,
    job_id: &str,
    archive_path: &Path,
    destination_dir: &Path,
) -> Result<(), String> {
    let kind = ArchiveKind::from_path(archive_path);

    if kind == ArchiveKind::Zip {
        return extract_zip(app, job_id, archive_path, destination_dir);
    }

    let tools = system_tools();

    match kind {
        ArchiveKind::Rar if tools.has_unrar => {
            extract_unrar(app, job_id, archive_path, destination_dir)
        }
        ArchiveKind::Tar if tools.has_tar => {
            extract_tar(app, job_id, archive_path, destination_dir)
        }
        _ if tools.has_7z => extract_7z(app, job_id, archive_path, destination_dir),
        _ if tools.has_tar => extract_tar(app, job_id, archive_path, destination_dir),
        _ => {
            let ext = archive_path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            Err(format!(
                "No se encontró herramienta de extracción (7z, unrar, tar) para .{ext}"
            ))
        }
    }
}

/// Busca el primer archivo comprimido dentro de `dir`.
fn find_first_archive_in(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(is_archive)
        })
}

/// Localiza el archivo a extraer: primero el nombre de salida indicado y, si no
/// existe o no es un archivo comprimido, el primero que haya en el directorio.
fn find_archive_path(destination_dir: &Path, output_file_name: Option<&str>) -> Option<PathBuf> {
    output_file_name
        .filter(|name| is_archive(name))
        .map(|name| destination_dir.join(name))
        .filter(|path| path.is_file())
        .or_else(|| find_first_archive_in(destination_dir))
}

/// Marca el job como completado, emite los eventos, lo elimina de la cola y
/// dispara el reescaneo del inventario.
fn finalize_job(app: &AppHandle, state: &SourcesState, job_id: &str) {
    if let Ok(mut job) = find_job(state, job_id) {
        job.status = SourceJobStatus::Completed;
        job.updated_at = now_iso();
        let _ = state.upsert_job(job.clone());
        emit_progress(app, &job);
        emit_terminal(app, &job);
        let _ = state.remove_job(job_id);
        spawn_inventory_rescan_after_download();
    }
}

/// Procesa la fase posterior a la descarga: extrae el archivo (si la opción
/// `auto_extract_downloads` está activa), borra el comprimido y finaliza el job.
///
/// La extracción corre en un hilo bloqueante para no frenar el runtime async.
/// El archivo comprimido **solo se elimina si la extracción terminó con éxito**;
/// si falla se conserva para poder reintentar o extraer manualmente.
///
/// # Argumentos
/// * `app` - Handle de Tauri.
/// * `job_id` - Identificador del job.
/// * `destination_dir` - Carpeta donde se descargó (y se extraerá) el contenido.
/// * `output_file_name` - Nombre del archivo descargado, si se conoce.
pub async fn process_post_download_extraction(
    app: AppHandle,
    job_id: String,
    destination_dir: String,
    output_file_name: Option<String>,
) {
    let state = app.state::<SourcesState>();
    let dest_path = PathBuf::from(&destination_dir);

    let Some(archive_path) = find_archive_path(&dest_path, output_file_name.as_deref()) else {
        finalize_job(&app, &state, &job_id);
        return;
    };

    if !crate::config::load_settings().auto_extract_downloads {
        finalize_job(&app, &state, &job_id);
        return;
    }

    let worker_app = app.clone();
    let worker_job_id = job_id.clone();
    let worker_archive = archive_path.clone();
    let worker_destination = dest_path.clone();

    let extraction_ok = match tokio::task::spawn_blocking(move || {
        extract_archive(
            &worker_app,
            &worker_job_id,
            &worker_archive,
            &worker_destination,
        )
    })
    .await
    {
        Ok(Ok(())) => true,
        Ok(Err(error)) => {
            log::error!("Error de extracción en job {job_id}: {error}");
            false
        }
        Err(error) => {
            log::error!("Falló el worker de extracción del job {job_id}: {error}");
            false
        }
    };

    if extraction_ok {
        let _ = std::fs::remove_file(&archive_path);
    }
    finalize_job(&app, &state, &job_id);
}