use super::domain::SourceJobStatus;
use super::events::{emit_progress, emit_terminal};
use super::queue::{find_job, now_iso, spawn_inventory_rescan_after_download, SourcesState};
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

const COPY_BUF_SIZE: usize = 512 * 1024;

struct SystemTools {
    has_7z: bool,
    has_unrar: bool,
    has_tar: bool,
}

static SYSTEM_TOOLS: OnceLock<SystemTools> = OnceLock::new();

fn system_tools() -> &'static SystemTools {
    SYSTEM_TOOLS.get_or_init(|| SystemTools {
        has_7z: Command::new("7z")
            .arg("i")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok(),
        has_unrar: Command::new("unrar")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok(),
        has_tar: Command::new("tar")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok(),
    })
}

pub fn is_archive(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    matches!(
        lower.rsplit_once('.').map(|(_, ext)| ext),
        Some("zip" | "rar" | "7z" | "tar" | "tgz" | "gz" | "zst")
    ) || lower.ends_with(".tar.gz")
        || lower.ends_with(".tar.zst")
}

#[inline]
fn push_progress(app: &AppHandle, state: &SourcesState, job_id: &str, loaded: u64, total: u64) {
    if let Ok(mut job) = find_job(state, job_id) {
        job.status = SourceJobStatus::Extracting;
        job.loaded = loaded;
        job.total = total;
        job.download_speed_bytes = 0;
        job.eta_seconds = None;
        job.updated_at = now_iso();
        let _ = state.upsert_job(job.clone());
        emit_progress(app, &job);
    }
}

pub fn extract_zip(
    app: &AppHandle,
    job_id: &str,
    archive_path: &Path,
    destination_dir: &Path,
) -> Result<(), String> {
    let file =
        std::fs::File::open(archive_path).map_err(|e| format!("No se pudo abrir ZIP: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Formato ZIP inválido: {e}"))?;

    let total_files = archive.len();
    if total_files == 0 {
        return Ok(());
    }

    let mut total_uncompressed: u64 = 0;
    for i in 0..total_files {
        if let Ok(f) = archive.by_index_raw(i) {
            total_uncompressed += f.size();
        }
    }
    let total_uncompressed = total_uncompressed.max(1);
    let archive_size = archive_path.metadata().map(|m| m.len()).unwrap_or(1);

    std::fs::create_dir_all(destination_dir)
        .map_err(|e| format!("No se pudo crear directorio destino: {e}"))?;

    let state = app.state::<SourcesState>();
    let mut extracted_bytes: u64 = 0;
    let mut last_update = std::time::Instant::now();
    let throttle = std::time::Duration::from_millis(250);
    let mut copy_buf = vec![0u8; COPY_BUF_SIZE];

    for i in 0..total_files {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Error leyendo entrada {i}: {e}"))?;

        let outpath = match entry.enclosed_name() {
            Some(p) => destination_dir.join(p),
            None => continue,
        };

        let entry_size = entry.size();

        if entry.is_dir() {
            std::fs::create_dir_all(&outpath)
                .map_err(|e| format!("No se pudo crear directorio: {e}"))?;
        } else {
            if let Some(parent) = outpath.parent() {
                if !parent.exists() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| format!("No se pudo crear padre: {e}"))?;
                }
            }

            let outfile = std::fs::File::create(&outpath)
                .map_err(|e| format!("No se pudo crear {}: {e}", outpath.display()))?;

            let mut writer = BufWriter::with_capacity(COPY_BUF_SIZE, outfile);
            loop {
                let n = entry
                    .read(&mut copy_buf)
                    .map_err(|e| format!("Error leyendo ZIP entrada: {e}"))?;
                if n == 0 {
                    break;
                }
                writer
                    .write_all(&copy_buf[..n])
                    .map_err(|e| format!("Error escribiendo {}: {e}", outpath.display()))?;
            }
            writer
                .flush()
                .map_err(|e| format!("Error en flush {}: {e}", outpath.display()))?;
        }

        extracted_bytes += entry_size;

        let now = std::time::Instant::now();
        if i == total_files - 1 || now.duration_since(last_update) >= throttle {
            let loaded = (extracted_bytes * archive_size) / total_uncompressed;
            push_progress(app, &state, job_id, loaded, archive_size);
            last_update = now;
        }
    }

    Ok(())
}

fn extract_7z(
    app: &AppHandle,
    job_id: &str,
    archive_path: &Path,
    destination_dir: &Path,
) -> Result<(), String> {
    let archive_size = archive_path.metadata().map(|m| m.len()).unwrap_or(1);

    let mut child = Command::new("7z")
        .args([
            "x",
            "-bsp1",
            "-bso0",
            archive_path.to_string_lossy().as_ref(),
            &format!("-o{}", destination_dir.to_string_lossy()),
            "-y",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar 7z: {e}"))?;

    let stdout = child.stdout.take().ok_or("No stdout de 7z")?;
    let reader = BufReader::new(stdout);
    let state = app.state::<SourcesState>();
    let mut last_update = std::time::Instant::now();
    let throttle = std::time::Duration::from_millis(250);

    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim_start();
        if let Some(pct_str) = trimmed.split('%').next() {
            if let Ok(pct) = pct_str.trim().parse::<u64>() {
                let now = std::time::Instant::now();
                if now.duration_since(last_update) >= throttle {
                    let loaded = (pct.min(100) * archive_size) / 100;
                    push_progress(app, &state, job_id, loaded, archive_size);
                    last_update = now;
                }
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Error esperando 7z: {e}"))?;
    if !status.success() {
        return Err("7z falló durante la extracción".into());
    }

    push_progress(app, &state, job_id, archive_size, archive_size);
    Ok(())
}

fn extract_unrar(
    app: &AppHandle,
    job_id: &str,
    archive_path: &Path,
    destination_dir: &Path,
) -> Result<(), String> {
    let archive_size = archive_path.metadata().map(|m| m.len()).unwrap_or(1);

    let mut child = Command::new("unrar")
        .args([
            "x",
            "-p-",
            "-y",
            archive_path.to_string_lossy().as_ref(),
            destination_dir.to_string_lossy().as_ref(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar unrar: {e}"))?;

    let stderr = child.stderr.take().ok_or("No stderr de unrar")?;
    let reader = BufReader::new(stderr);
    let state = app.state::<SourcesState>();
    let mut extracted: u64 = 0;
    let mut last_update = std::time::Instant::now();
    let throttle = std::time::Duration::from_millis(250);

    for line in reader.lines().map_while(Result::ok) {
        if line.trim_start().starts_with("Extracting") {
            extracted += 1;
            let now = std::time::Instant::now();
            if now.duration_since(last_update) >= throttle {
                push_progress(
                    app,
                    &state,
                    job_id,
                    extracted * 1024,
                    archive_size.max(extracted * 1024),
                );
                last_update = now;
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Error esperando unrar: {e}"))?;
    if !status.success() {
        return Err("unrar falló durante la extracción".into());
    }

    push_progress(app, &state, job_id, archive_size, archive_size);
    Ok(())
}

fn extract_tar(
    app: &AppHandle,
    job_id: &str,
    archive_path: &Path,
    destination_dir: &Path,
) -> Result<(), String> {
    let archive_size = archive_path.metadata().map(|m| m.len()).unwrap_or(1);

    let checkpoint_bytes: u64 = 512 * 512;

    std::fs::create_dir_all(destination_dir)
        .map_err(|e| format!("No se pudo crear directorio destino: {e}"))?;

    let mut child = Command::new("tar")
        .args([
            "--checkpoint=512",
            "--checkpoint-action=echo=#%u",
            "-xf",
            archive_path.to_string_lossy().as_ref(),
            "-C",
            destination_dir.to_string_lossy().as_ref(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar tar: {e}"))?;

    let stderr = child.stderr.take().ok_or("No stderr de tar")?;
    let reader = BufReader::new(stderr);
    let state = app.state::<SourcesState>();
    let mut last_update = std::time::Instant::now();
    let throttle = std::time::Duration::from_millis(250);

    for line in reader.lines().map_while(Result::ok) {
        if let Some(num_str) = line.strip_prefix('#') {
            if let Ok(checkpoint) = num_str.trim().parse::<u64>() {
                let now = std::time::Instant::now();
                if now.duration_since(last_update) >= throttle {
                    let loaded = (checkpoint * checkpoint_bytes).min(archive_size);
                    push_progress(app, &state, job_id, loaded, archive_size);
                    last_update = now;
                }
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Error esperando tar: {e}"))?;
    if !status.success() {
        return Err("tar falló durante la extracción".into());
    }

    push_progress(app, &state, job_id, archive_size, archive_size);
    Ok(())
}

pub fn extract_archive(
    app: &AppHandle,
    job_id: &str,
    archive_path: &Path,
    destination_dir: &Path,
) -> Result<(), String> {
    let ext = archive_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "zip" {
        return extract_zip(app, job_id, archive_path, destination_dir);
    }

    let tools = system_tools();

    if tools.has_7z {
        extract_7z(app, job_id, archive_path, destination_dir)
    } else if tools.has_unrar && ext == "rar" {
        extract_unrar(app, job_id, archive_path, destination_dir)
    } else if tools.has_tar {
        extract_tar(app, job_id, archive_path, destination_dir)
    } else {
        Err(format!(
            "No se encontró herramienta de extracción (7z, unrar, tar) para .{ext}"
        ))
    }
}

pub async fn process_post_download_extraction(
    app: AppHandle,
    job_id: String,
    destination_dir: String,
    output_file_name: Option<String>,
) {
    let state = app.state::<SourcesState>();

    let archive_path: Option<PathBuf> = output_file_name
        .as_deref()
        .filter(|f| is_archive(f))
        .map(|f| Path::new(&destination_dir).join(f))
        .filter(|p| p.is_file())
        .or_else(|| {
            std::fs::read_dir(&destination_dir)
                .ok()?
                .flatten()
                .find_map(|e| {
                    let p = e.path();
                    if p.is_file() && p.file_name()?.to_str().map(is_archive).unwrap_or(false) {
                        Some(p)
                    } else {
                        None
                    }
                })
        });

    let finalize = |app: &AppHandle, state: &SourcesState, job_id: &str| {
        if let Ok(mut job) = find_job(state, job_id) {
            job.status = SourceJobStatus::Completed;
            job.updated_at = now_iso();
            let _ = state.upsert_job(job.clone());
            emit_progress(app, &job);
            emit_terminal(app, &job);
            let _ = state.remove_job(job_id);
            spawn_inventory_rescan_after_download();
        }
    };

    let Some(path) = archive_path else {
        finalize(&app, &state, &job_id);
        return;
    };

    let settings = crate::config::load_settings();
    if !settings.auto_extract_downloads {
        finalize(&app, &state, &job_id);
        return;
    }

    let dest_path = PathBuf::from(&destination_dir);

    if let Err(err) = extract_archive(&app, &job_id, &path, &dest_path) {
        log::error!("Error de extracción en job {job_id}: {err}");
    }

    let _ = std::fs::remove_file(&path);
    finalize(&app, &state, &job_id);
}
