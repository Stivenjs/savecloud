//! Escaneo BLAKE3 full_verify de carpetas instaladas y archivos de fuentes.

use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use blake3::Hasher;
use chrono::Utc;
use walkdir::WalkDir;

use crate::config::{self, ConfiguredGame};
use crate::peer_inventory::game_key::game_key_for_configured_game;
use crate::sources::store as sources_store;

use super::install_paths::{job_matches_game_key, resolve_install_root};
use super::models::{
    DeviceInventoryManifest, GameInventoryEntry, InventoryFileEntry, SourcesArchiveEntry,
};
use super::overrides::{manual_install_root, set_manual_install_root};
use super::store::{
    load_local_manifest, now_iso, resolve_device_id, resolve_device_name, save_local_manifest,
};

const MANIFEST_VERSION: u32 = 1;
const HASH_PREFIX: &str = "blake3:";

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|e| format!("No se pudo abrir {}: {e}", path.display()))?;
    let mut hasher = Hasher::new();
    let mut buf = [0u8; 1024 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("Error leyendo {}: {e}", path.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{HASH_PREFIX}{}", hasher.finalize().to_hex()))
}

fn normalize_relative(path: &Path, root: &Path) -> Result<String, String> {
    let rel = path
        .strip_prefix(root)
        .map_err(|_| format!("Ruta fuera de raíz: {}", path.display()))?;
    let mut parts = Vec::new();
    for comp in rel.components() {
        match comp {
            Component::Normal(p) => parts.push(p.to_string_lossy().replace('\\', "/")),
            Component::CurDir => {}
            _ => {
                return Err(format!(
                    "Componente de ruta no permitido: {}",
                    path.display()
                ))
            }
        }
    }
    Ok(parts.join("/"))
}

fn scan_folder_at_root(
    game_key: &str,
    display_name: &str,
    root: &Path,
) -> Result<Option<GameInventoryEntry>, String> {
    if !root.is_dir() {
        return Ok(None);
    }

    let display_name = display_name.trim();
    let display_name = if display_name.is_empty() {
        game_key.to_string()
    } else {
        display_name.to_string()
    };

    let mut files = Vec::new();
    let mut total_bytes = 0_u64;

    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let meta = fs::metadata(path).map_err(|e| e.to_string())?;
        let size = meta.len();
        let hash = hash_file(path)?;
        let relative_path = normalize_relative(path, root)?;
        total_bytes = total_bytes.saturating_add(size);
        files.push(InventoryFileEntry {
            relative_path,
            size,
            hash,
        });
    }

    if files.is_empty() {
        return Ok(None);
    }

    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    let verified_at = Utc::now().to_rfc3339();
    let manifest_hash = entry_content_hash(&files);

    Ok(Some(GameInventoryEntry {
        game_key: game_key.to_string(),
        display_name,
        status: "verified".to_string(),
        payload_kind: "installedFolder".to_string(),
        total_bytes,
        file_count: files.len() as u32,
        manifest_hash,
        verified_at,
        files,
        sources_archive: None,
        install_root: Some(root.to_string_lossy().into_owned()),
    }))
}

fn scan_installed_folder(
    game: &ConfiguredGame,
    root: &Path,
) -> Result<Option<GameInventoryEntry>, String> {
    let game_key =
        game_key_for_configured_game(game).ok_or_else(|| "gameKey no disponible".to_string())?;
    let display_name = game
        .edition_label
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| game.id.clone());
    scan_folder_at_root(&game_key, &display_name, root)
}

fn entry_content_hash(files: &[InventoryFileEntry]) -> String {
    let mut hasher = Hasher::new();
    for f in files {
        hasher.update(f.relative_path.as_bytes());
        hasher.update(&f.size.to_le_bytes());
        hasher.update(f.hash.as_bytes());
    }
    format!("{HASH_PREFIX}{}", hasher.finalize().to_hex())
}

fn scan_sources_archives_for_game(
    game: &ConfiguredGame,
    game_key: &str,
) -> Result<Option<SourcesArchiveEntry>, String> {
    let jobs = sources_store::load_jobs().unwrap_or_default();
    let mut best: Option<SourcesArchiveEntry> = None;

    for job in jobs {
        if job.status != crate::sources::domain::SourceJobStatus::Completed {
            continue;
        }
        if !job_matches_game_key(&job, game, game_key) {
            continue;
        }
        let Some(ref output_name) = job.output_file_name else {
            continue;
        };
        if job.protocol != crate::sources::domain::DownloadProtocol::Http {
            continue;
        }
        let archive_path = PathBuf::from(&job.destination_dir).join(output_name);
        if !archive_path.is_file() {
            continue;
        }
        let size = fs::metadata(&archive_path)
            .map_err(|e| e.to_string())?
            .len();
        let hash = hash_file(&archive_path)?;
        let verified_at = Utc::now().to_rfc3339();
        let entry = SourcesArchiveEntry {
            job_id: job.job_id.clone(),
            relative_path: output_name.clone(),
            size,
            hash,
            verified_at,
        };
        if best.as_ref().is_none_or(|b| entry.size > b.size) {
            best = Some(entry);
        }
    }

    Ok(best)
}

fn upsert_verified_entry(
    games: &mut Vec<GameInventoryEntry>,
    seen_keys: &mut std::collections::HashSet<String>,
    entry: GameInventoryEntry,
) {
    if let Some(existing) = games.iter_mut().find(|g| g.game_key == entry.game_key) {
        if entry.total_bytes > existing.total_bytes {
            *existing = entry;
        }
        return;
    }
    seen_keys.insert(entry.game_key.clone());
    games.push(entry);
}

fn resolve_scan_root(game: &ConfiguredGame, game_key: &str) -> Option<PathBuf> {
    manual_install_root(game_key).or_else(|| resolve_install_root(game, game_key))
}

pub fn register_manual_install_folder(
    user_id: &str,
    sharing_enabled: bool,
    steam_app_id: &str,
    display_name: &str,
    folder: &Path,
) -> Result<DeviceInventoryManifest, String> {
    let app_id = steam_app_id.trim();
    if app_id.is_empty() {
        return Err("Selecciona un juego de Steam".to_string());
    }

    let game_key = crate::peer_inventory::game_key::game_key_for_catalog_steam(app_id)
        .ok_or_else(|| "Steam App ID inválido".to_string())?;

    set_manual_install_root(&game_key, folder)?;

    let entry = scan_folder_at_root(&game_key, display_name, folder)?
        .ok_or_else(|| "La carpeta no contiene archivos de juego indexables".to_string())?;

    let mut manifest = load_local_manifest()?.unwrap_or_else(|| DeviceInventoryManifest {
        device_id: resolve_device_id().unwrap_or_default(),
        device_name: resolve_device_name(),
        user_id: user_id.to_string(),
        manifest_version: MANIFEST_VERSION,
        content_hash: String::new(),
        updated_at: now_iso(),
        sharing_enabled,
        games: Vec::new(),
    });

    manifest.user_id = user_id.to_string();
    manifest.sharing_enabled = sharing_enabled;
    manifest.updated_at = now_iso();

    let mut seen_keys = std::collections::HashSet::new();
    let mut games: Vec<GameInventoryEntry> = manifest
        .games
        .into_iter()
        .filter(|g| {
            if g.game_key == game_key {
                false
            } else {
                seen_keys.insert(g.game_key.clone());
                true
            }
        })
        .collect();

    upsert_verified_entry(&mut games, &mut seen_keys, entry);
    games.sort_by(|a, b| a.game_key.cmp(&b.game_key));
    manifest.content_hash = manifest_content_hash(&games);
    manifest.games = games;
    save_local_manifest(&manifest)?;
    Ok(manifest)
}

pub fn scan_full_inventory(
    user_id: &str,
    sharing_enabled: bool,
) -> Result<DeviceInventoryManifest, String> {
    let device_id = resolve_device_id()?;
    let device_name = resolve_device_name();
    let library = config::load_library();

    let mut games: Vec<GameInventoryEntry> = Vec::new();
    let mut seen_keys = std::collections::HashSet::new();

    for game in &library.games {
        let Some(game_key) = game_key_for_configured_game(game) else {
            continue;
        };
        if let Some(root) = resolve_scan_root(game, &game_key) {
            if let Some(mut entry) = scan_installed_folder(game, &root)? {
                if let Some(archive) = scan_sources_archives_for_game(game, &game_key)? {
                    entry.sources_archive = Some(archive);
                }
                upsert_verified_entry(&mut games, &mut seen_keys, entry);
                continue;
            }
        }
        if seen_keys.contains(&game_key) {
            continue;
        }
        if let Some(archive) = scan_sources_archives_for_game(game, &game_key)? {
            let display_name = game
                .edition_label
                .clone()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| game.id.clone());
            let verified_at = Utc::now().to_rfc3339();
            upsert_verified_entry(
                &mut games,
                &mut seen_keys,
                GameInventoryEntry {
                    game_key: game_key.clone(),
                    display_name,
                    status: "verified".to_string(),
                    payload_kind: "sourcesArchive".to_string(),
                    total_bytes: archive.size,
                    file_count: 1,
                    manifest_hash: archive.hash.clone(),
                    verified_at,
                    files: vec![InventoryFileEntry {
                        relative_path: archive.relative_path.clone(),
                        size: archive.size,
                        hash: archive.hash.clone(),
                    }],
                    sources_archive: Some(archive.clone()),
                    install_root: sources_store::load_jobs().ok().and_then(|jobs| {
                        jobs.iter()
                            .find(|j| j.job_id == archive.job_id)
                            .map(|j| j.destination_dir.clone())
                    }),
                },
            );
        }
    }

    games.sort_by(|a, b| a.game_key.cmp(&b.game_key));

    let content_hash = manifest_content_hash(&games);
    let manifest = DeviceInventoryManifest {
        device_id,
        device_name,
        user_id: user_id.to_string(),
        manifest_version: MANIFEST_VERSION,
        content_hash,
        updated_at: now_iso(),
        sharing_enabled,
        games,
    };

    save_local_manifest(&manifest)?;
    Ok(manifest)
}

fn manifest_content_hash(games: &[GameInventoryEntry]) -> String {
    let mut hasher = Hasher::new();
    for g in games {
        hasher.update(g.game_key.as_bytes());
        hasher.update(g.manifest_hash.as_bytes());
        hasher.update(&g.total_bytes.to_le_bytes());
    }
    format!("{HASH_PREFIX}{}", hasher.finalize().to_hex())
}
