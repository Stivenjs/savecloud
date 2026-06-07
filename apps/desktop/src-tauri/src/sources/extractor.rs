use super::domain::SourceJobStatus;
use super::events::{emit_progress, emit_terminal};
use super::queue::{find_job, now_iso, spawn_inventory_rescan_after_download, SourcesState};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Manager};

pub fn is_archive(filename: &str) -> bool {
    let lower = filename.to_lowercase();
    lower.ends_with(".zip")
        || lower.ends_with(".rar")
        || lower.ends_with(".7z")
        || lower.ends_with(".tar")
        || lower.ends_with(".tar.gz")
        || lower.ends_with(".tgz")
        || lower.ends_with(".tar.zst")
}

pub fn extract_zip(
    app: &AppHandle,
    job_id: &str,
    archive_path: &Path,
    destination_dir: &Path,
) -> Result<(), String> {
    let file = std::fs::File::open(archive_path)
        .map_err(|e| format!("No se pudo abrir el archivo ZIP: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Formato ZIP inválido: {e}"))?;

    let total_files = archive.len();
    if total_files == 0 {
        return Ok(());
    }

    let archive_size = archive_path.metadata().map(|m| m.len()).unwrap_or(0);

    let mut total_uncompressed_bytes = 0_u64;
    for i in 0..total_files {
        if let Ok(file) = archive.by_index(i) {
            total_uncompressed_bytes += file.size();
        }
    }
    let total_uncompressed_bytes = total_uncompressed_bytes.max(1);

    std::fs::create_dir_all(destination_dir)
        .map_err(|e| format!("No se pudo crear el directorio de destino: {e}"))?;

    let state = app.state::<SourcesState>();
    let mut extracted_uncompressed_bytes = 0_u64;
    let mut last_update = std::time::Instant::now();

    for i in 0..total_files {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Error al leer archivo {i} en ZIP: {e}"))?;

        let outpath = match file.enclosed_name() {
            Some(path) => destination_dir.join(path),
            None => continue,
        };

        let file_size = file.size();

        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath)
                .map_err(|e| format!("No se pudo crear subdirectorio: {e}"))?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    std::fs::create_dir_all(p)
                        .map_err(|e| format!("No se pudo crear subdirectorio padre: {e}"))?;
                }
            }
            let outfile = std::fs::File::create(&outpath)
                .map_err(|e| format!("No se pudo crear archivo {}: {e}", outpath.display()))?;

            let mut writer = BufWriter::with_capacity(128 * 1024, outfile);
            std::io::copy(&mut file, &mut writer)
                .map_err(|e| format!("Error escribiendo archivo {}: {e}", outpath.display()))?;
            writer
                .flush()
                .map_err(|e| format!("Error al flush archivo {}: {e}", outpath.display()))?;
        }

        extracted_uncompressed_bytes += file_size;

        let now = std::time::Instant::now();
        if i == total_files - 1
            || now.duration_since(last_update) >= std::time::Duration::from_millis(250)
        {
            let loaded_bytes =
                (extracted_uncompressed_bytes * archive_size) / total_uncompressed_bytes;
            update_progress(app, &state, job_id, loaded_bytes, archive_size);
            last_update = now;
        }
    }

    Ok(())
}

fn update_progress(
    app: &AppHandle,
    state: &SourcesState,
    job_id: &str,
    loaded_bytes: u64,
    total_bytes: u64,
) {
    if let Ok(mut job) = find_job(state, job_id) {
        job.status = SourceJobStatus::Extracting;
        job.loaded = loaded_bytes;
        job.total = total_bytes;
        job.download_speed_bytes = 0;
        job.eta_seconds = None;
        job.updated_at = now_iso();
        let _ = state.upsert_job(job.clone());
        emit_progress(app, &job);
    }
}

fn extract_7z(
    app: &AppHandle,
    job_id: &str,
    archive_path: &Path,
    destination_dir: &Path,
) -> Result<(), String> {
    let archive_size = archive_path.metadata().map(|m| m.len()).unwrap_or(0);

    let list_output = Command::new("7z")
        .args(["l", archive_path.to_string_lossy().as_ref()])
        .output()
        .map_err(|e| format!("Error listando con 7z: {e}"))?;

    let list_str = String::from_utf8_lossy(&list_output.stdout);
    let mut total_files = 1;
    for line in list_str.lines().rev().take(10) {
        if line.contains("files") {
            if let Some(idx) = line.find("files") {
                let parts: Vec<&str> = line[..idx].split_whitespace().collect();
                if let Some(last) = parts.last() {
                    if let Ok(num) = last.parse::<usize>() {
                        total_files = num.max(1);
                        break;
                    }
                }
            }
        }
    }

    std::fs::create_dir_all(destination_dir)
        .map_err(|e| format!("No se pudo crear directorio destino: {e}"))?;

    let mut child = Command::new("7z")
        .args([
            "x",
            archive_path.to_string_lossy().as_ref(),
            &format!("-o{}", destination_dir.to_string_lossy()),
            "-y",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar 7z: {e}"))?;

    let stdout = child.stdout.take().ok_or("No se pudo leer salida de 7z")?;
    let reader = BufReader::new(stdout);
    let state = app.state::<SourcesState>();
    let mut extracted = 0;
    let mut last_update = std::time::Instant::now();

    for line in reader.lines() {
        if let Ok(l) = line {
            if l.trim_start().starts_with("Extracting") {
                extracted += 1;

                let now = std::time::Instant::now();
                if now.duration_since(last_update) >= std::time::Duration::from_millis(250) {
                    let loaded_bytes =
                        (extracted.min(total_files) as u64 * archive_size) / total_files as u64;
                    update_progress(app, &state, job_id, loaded_bytes, archive_size);
                    last_update = now;
                }
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Error esperando 7z: {e}"))?;
    if !status.success() {
        return Err("7z falló durante la extracción".to_string());
    }

    update_progress(app, &state, job_id, archive_size, archive_size);
    Ok(())
}

fn extract_unrar(
    app: &AppHandle,
    job_id: &str,
    archive_path: &Path,
    destination_dir: &Path,
) -> Result<(), String> {
    let archive_size = archive_path.metadata().map(|m| m.len()).unwrap_or(0);

    let list_output = Command::new("unrar")
        .args(["l", archive_path.to_string_lossy().as_ref()])
        .output()
        .map_err(|e| format!("Error listando con unrar: {e}"))?;

    let list_str = String::from_utf8_lossy(&list_output.stdout);
    let mut total_files = 1;
    for line in list_str.lines().rev().take(10) {
        if line.contains("files") {
            if let Some(idx) = line.find("files") {
                let parts: Vec<&str> = line[..idx].split_whitespace().collect();
                if let Some(last) = parts.last() {
                    if let Ok(num) = last.parse::<usize>() {
                        total_files = num.max(1);
                        break;
                    }
                }
            }
        }
    }

    std::fs::create_dir_all(destination_dir)
        .map_err(|e| format!("No se pudo crear directorio destino: {e}"))?;

    let mut child = Command::new("unrar")
        .args([
            "x",
            archive_path.to_string_lossy().as_ref(),
            destination_dir.to_string_lossy().as_ref(),
            "-y",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar unrar: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or("No se pudo leer salida de unrar")?;
    let reader = BufReader::new(stdout);
    let state = app.state::<SourcesState>();
    let mut extracted = 0;
    let mut last_update = std::time::Instant::now();

    for line in reader.lines() {
        if let Ok(l) = line {
            if l.trim_start().starts_with("Extracting") {
                extracted += 1;

                let now = std::time::Instant::now();
                if now.duration_since(last_update) >= std::time::Duration::from_millis(250) {
                    let loaded_bytes =
                        (extracted.min(total_files) as u64 * archive_size) / total_files as u64;
                    update_progress(app, &state, job_id, loaded_bytes, archive_size);
                    last_update = now;
                }
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Error esperando unrar: {e}"))?;
    if !status.success() {
        return Err("unrar falló durante la extracción".to_string());
    }

    update_progress(app, &state, job_id, archive_size, archive_size);
    Ok(())
}

fn extract_tar(
    app: &AppHandle,
    job_id: &str,
    archive_path: &Path,
    destination_dir: &Path,
) -> Result<(), String> {
    let archive_size = archive_path.metadata().map(|m| m.len()).unwrap_or(0);

    let count_output = Command::new("tar")
        .args(["-tf", archive_path.to_string_lossy().as_ref()])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|e| format!("Error listando con tar: {e}"))?;

    let total_files = BufReader::new(&count_output.stdout[..])
        .lines()
        .filter_map(|l| l.ok())
        .filter(|l| !l.trim().is_empty())
        .count();

    let total_files = if total_files == 0 { 1 } else { total_files };

    std::fs::create_dir_all(destination_dir)
        .map_err(|e| format!("No se pudo crear directorio destino: {e}"))?;

    let mut child = Command::new("tar")
        .args([
            "-xvf",
            archive_path.to_string_lossy().as_ref(),
            "-C",
            destination_dir.to_string_lossy().as_ref(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("No se pudo iniciar tar: {e}"))?;

    let stderr = child
        .stderr
        .take()
        .ok_or("No se pudo leer salida de errores de tar")?;
    let reader = BufReader::new(stderr);
    let state = app.state::<SourcesState>();
    let mut extracted = 0;
    let mut last_update = std::time::Instant::now();

    for line in reader.lines() {
        if let Ok(_) = line {
            extracted += 1;

            let now = std::time::Instant::now();
            if now.duration_since(last_update) >= std::time::Duration::from_millis(250) {
                let loaded_bytes =
                    (extracted.min(total_files) as u64 * archive_size) / total_files as u64;
                update_progress(app, &state, job_id, loaded_bytes, archive_size);
                last_update = now;
            }
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Error esperando tar: {e}"))?;
    if !status.success() {
        return Err("tar falló durante la extracción".to_string());
    }

    update_progress(app, &state, job_id, archive_size, archive_size);
    Ok(())
}

pub fn extract_archive(
    app: &AppHandle,
    job_id: &str,
    archive_path: &Path,
    destination_dir: &Path,
) -> Result<(), String> {
    let extension = archive_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if extension == "zip" {
        extract_zip(app, job_id, archive_path, destination_dir)
    } else {
        extract_via_system_tool(app, job_id, archive_path, destination_dir)
    }
}

fn extract_via_system_tool(
    app: &AppHandle,
    job_id: &str,
    archive_path: &Path,
    destination_dir: &Path,
) -> Result<(), String> {
    let extension = archive_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let has_7z = Command::new("7z")
        .arg("--help")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok();

    let has_unrar = if extension == "rar" {
        Command::new("unrar")
            .arg("--help")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
    } else {
        false
    };

    let has_tar = Command::new("tar")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok();

    if has_7z {
        extract_7z(app, job_id, archive_path, destination_dir)
    } else if has_unrar && extension == "rar" {
        extract_unrar(app, job_id, archive_path, destination_dir)
    } else if has_tar {
        extract_tar(app, job_id, archive_path, destination_dir)
    } else {
        Err(format!(
            "No se encontró ninguna herramienta de extracción compatible (7z, unrar o tar) para descomprimir el archivo .{}",
            extension
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
    let mut archive_path: Option<PathBuf> = None;

    if let Some(ref file) = output_file_name {
        if is_archive(file) {
            let path = Path::new(&destination_dir).join(file);
            if path.is_file() {
                archive_path = Some(path);
            }
        }
    }

    if archive_path.is_none() {
        if let Ok(entries) = std::fs::read_dir(&destination_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if is_archive(name) {
                            archive_path = Some(path);
                            break;
                        }
                    }
                }
            }
        }
    }

    let Some(path) = archive_path else {
        if let Ok(mut job) = find_job(&state, &job_id) {
            job.status = SourceJobStatus::Completed;
            job.updated_at = now_iso();
            let _ = state.upsert_job(job.clone());
            emit_progress(&app, &job);
            emit_terminal(&app, &job);
            let _ = state.remove_job(&job_id);
            spawn_inventory_rescan_after_download();
        }
        return;
    };

    let dest_path = PathBuf::from(&destination_dir);
    match extract_archive(&app, &job_id, &path, &dest_path) {
        Ok(()) => {
            let _ = std::fs::remove_file(path);
            if let Ok(mut job) = find_job(&state, &job_id) {
                job.status = SourceJobStatus::Completed;
                job.updated_at = now_iso();
                let _ = state.upsert_job(job.clone());
                emit_progress(&app, &job);
                emit_terminal(&app, &job);
                let _ = state.remove_job(&job_id);
                spawn_inventory_rescan_after_download();
            }
        }
        Err(err) => {
            log::error!("Error de extracción en job {job_id}: {err}");
            if let Ok(mut job) = find_job(&state, &job_id) {
                job.status = SourceJobStatus::Completed;
                job.updated_at = now_iso();
                let _ = state.upsert_job(job.clone());
                emit_progress(&app, &job);
                emit_terminal(&app, &job);
                let _ = state.remove_job(&job_id);
                spawn_inventory_rescan_after_download();
            }
        }
    }
}
