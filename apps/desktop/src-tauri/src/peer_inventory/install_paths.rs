//! Resolución de carpetas de instalación (no confundir con rutas de guardado en `paths`).

use std::fs;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use crate::commands::scan::path_suggests_save_location;
use crate::config::ConfiguredGame;
use crate::sources::domain::{DownloadProtocol, SourceDownloadJob, SourceJobStatus};
use crate::sources::store as sources_store;

const MIN_INSTALL_BYTES: u64 = 100 * 1024 * 1024;

/// Carpeta de instalación verificable para un juego de biblioteca.
pub fn resolve_install_root(game: &ConfiguredGame, game_key: &str) -> Option<PathBuf> {
    if let Some(root) = install_root_from_launch_executable(game) {
        if root.is_dir() && looks_like_game_install_dir(&root, InstallRootTrust::LaunchExecutable) {
            return Some(root);
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(root) = install_root_from_steam(game, game_key) {
        candidates.push(root);
    }
    candidates.extend(install_roots_from_jobs(game, game_key));

    candidates
        .into_iter()
        .filter(|p| p.is_dir() && looks_like_game_install_dir(p, InstallRootTrust::Discovered))
        .max_by_key(|p| dir_total_bytes(p).unwrap_or(0))
}

enum InstallRootTrust {
    /// El usuario configuró el `.exe` de lanzamiento.
    LaunchExecutable,
    /// Steam, torrent u otra heurística.
    Discovered,
}

fn install_root_from_launch_executable(game: &ConfiguredGame) -> Option<PathBuf> {
    let exe = game.launch_executable_path.as_ref()?.trim();
    if exe.is_empty() {
        return None;
    }
    let path = PathBuf::from(exe);
    if !path.is_file() {
        return None;
    }
    path.parent().map(Path::to_path_buf)
}

fn install_root_from_steam(game: &ConfiguredGame, game_key: &str) -> Option<PathBuf> {
    let steam = game
        .steam_app_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    if game_key != format!("steam:{steam}") {
        return None;
    }
    crate::steam::resolve_steam_install_dir(steam)
}

fn is_steam_common_install(root: &Path) -> bool {
    let lower = root.to_string_lossy().to_lowercase();
    lower.contains("steamapps\\common") || lower.contains("steamapps/common")
}

fn install_roots_from_jobs(game: &ConfiguredGame, game_key: &str) -> Vec<PathBuf> {
    let Ok(jobs) = sources_store::load_jobs() else {
        return Vec::new();
    };

    let mut roots = Vec::new();
    for job in jobs {
        if job.status != SourceJobStatus::Completed {
            continue;
        }
        if !job_matches_game_key(&job, game, game_key) {
            continue;
        }
        let dest = PathBuf::from(&job.destination_dir);
        if !dest.is_dir() {
            continue;
        }
        match job.protocol {
            DownloadProtocol::TorrentMagnet
            | DownloadProtocol::TorrentFile
            | DownloadProtocol::PeerLan => {
                roots.push(dest);
            }
            DownloadProtocol::Http => {
                if http_destination_has_extracted_install(&dest, job.output_file_name.as_deref()) {
                    roots.push(dest);
                }
            }
            DownloadProtocol::Unknown => {}
        }
    }
    roots
}

fn http_destination_has_extracted_install(dest: &Path, output_file_name: Option<&str>) -> bool {
    if let Some(name) = output_file_name {
        let archive = dest.join(name);
        if archive.is_file() {
            let mut other_files = 0_u32;
            let mut other_dirs = 0_u32;
            if let Ok(read) = fs::read_dir(dest) {
                for entry in read.flatten() {
                    if entry.path() == archive {
                        continue;
                    }
                    if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        other_dirs += 1;
                    } else {
                        other_files += 1;
                    }
                }
            }
            if other_dirs == 0 && other_files == 0 {
                return false;
            }
        }
    }
    true
}

pub fn job_matches_game_key(
    job: &SourceDownloadJob,
    game: &ConfiguredGame,
    game_key: &str,
) -> bool {
    if job.item_id == game_key || job.item_id == game.id {
        return true;
    }
    if job.source_id == "peer-lan" && job.item_id == game_key {
        return true;
    }

    let game_slug = crate::sources::parser::slugify(&game.id);
    if game_key == format!("savecloud:{game_slug}") {
        let title_slug = crate::sources::parser::slugify(&job.title);
        if title_slug == game_slug {
            return true;
        }
    }

    if let Some(steam) = game
        .steam_app_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if game_key == format!("steam:{steam}")
            && (job.title.contains(steam) || job.item_id.contains(steam))
        {
            return true;
        }
    }

    false
}

/// Rechaza carpetas que son claramente solo guardados (no instalación).
/// No usa `folder_contains_save_like_files`: dentro de un juego hay muchos `.dat`/`.ini`.
fn install_root_is_save_only(root: &Path, trust: InstallRootTrust) -> bool {
    if is_steam_common_install(root) {
        return false;
    }

    if path_suggests_save_location(root) {
        return true;
    }

    if matches!(trust, InstallRootTrust::LaunchExecutable) {
        return false;
    }

    shallow_tree_looks_like_save_data(root)
}

fn shallow_tree_looks_like_save_data(root: &Path) -> bool {
    let mut files = 0_u32;
    let mut save_like = 0_u32;
    let mut ini_only = 0_u32;

    for entry in WalkDir::new(root)
        .max_depth(5)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        files += 1;
        let name = entry.file_name().to_string_lossy().to_lowercase();
        let ext = entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if is_save_like_extension(&ext, &name) {
            save_like += 1;
        }
        if ext == "ini" && entry.metadata().map(|m| m.len() <= 4).unwrap_or(false) {
            ini_only += 1;
        }
        if files >= 200 {
            break;
        }
    }

    if files == 0 {
        return true;
    }
    if save_like * 100 / files >= 40 {
        return true;
    }
    ini_only * 100 / files >= 70 && dir_total_bytes(root).unwrap_or(0) < MIN_INSTALL_BYTES
}

fn is_save_like_extension(ext: &str, file_name: &str) -> bool {
    matches!(
        ext,
        "sav" | "sl2" | "qdsav" | "hg" | "bak" | "dat" | "bin" | "json" | "log" | "vdf" | "xml"
    ) || file_name.contains("autosave")
        || file_name.contains("quicksave")
        || file_name.starts_with("save")
        || file_name.ends_with(".sav")
        || file_name.ends_with(".sl2")
}

fn looks_like_game_install_dir(root: &Path, trust: InstallRootTrust) -> bool {
    if install_root_is_save_only(root, trust) {
        return false;
    }

    let mut exe_count = 0_u32;
    let mut total_bytes = 0_u64;
    let mut file_count = 0_u32;

    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        file_count += 1;
        total_bytes = total_bytes.saturating_add(entry.metadata().map(|m| m.len()).unwrap_or(0));
        if entry
            .path()
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
        {
            exe_count += 1;
        }
        if file_count >= 5000 {
            break;
        }
    }

    if exe_count > 0 && total_bytes >= MIN_INSTALL_BYTES {
        return true;
    }
    if exe_count > 0 && file_count >= 50 {
        return true;
    }
    if total_bytes >= 5 * 1024 * 1024 * 1024 {
        return true;
    }

    false
}

fn dir_total_bytes(root: &Path) -> Result<u64, String> {
    let mut total = 0_u64;
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            total = total.saturating_add(entry.metadata().map(|m| m.len()).unwrap_or(0));
        }
    }
    Ok(total)
}
