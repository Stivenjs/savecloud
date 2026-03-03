import { invoke } from "@tauri-apps/api/core";
import type { Config } from "@app-types/config";

export interface PathCandidate {
  path: string;
  folderName: string;
  basePath: string;
}

/** Obtiene la configuración desde el archivo compartido con el CLI */
export async function getConfig(): Promise<Config> {
  return invoke<Config>("get_config");
}

/** Ruta del archivo de configuración (para mostrar al usuario) */
export async function getConfigPath(): Promise<string> {
  return invoke<string>("get_config_path");
}

/** Busca Steam App ID por nombre de juego (scraping dinámico) */
export async function searchSteamAppId(query: string): Promise<string | null> {
  return invoke<string | null>("search_steam_app_id", { query });
}

/** Obtiene el nombre del juego a partir del Steam App ID (API appdetails) */
export async function getSteamAppName(appId: string): Promise<string | null> {
  return invoke<string | null>("get_steam_app_name", { appId });
}

/** Comprueba si el juego está en ejecución (para mostrar advertencia) */
export function checkGameRunning(gameId: string): Promise<boolean> {
  return invoke<boolean>("check_game_running", { gameId });
}

/** Añade un juego a la configuración */
export async function addGame(gameId: string, path: string): Promise<void> {
  await invoke("add_game", { gameId, path });
}

/** Abre la carpeta de guardados del juego en el explorador */
export async function openSaveFolder(gameId: string): Promise<void> {
  await invoke("open_save_folder", { gameId });
}

/** Exporta la configuración a un archivo JSON. Devuelve el path. */
export async function exportConfigToFile(path: string): Promise<string> {
  return invoke("export_config_to_file", { path });
}

/** Crea o actualiza el archivo de configuración con apiBaseUrl, apiKey y userId. Devuelve la ruta del archivo. */
export async function createConfigFile(
  apiBaseUrl: string,
  apiKey: string,
  userId: string
): Promise<string> {
  return invoke<string>("create_config_file", {
    api_base_url: apiBaseUrl.trim() || null,
    api_key: apiKey.trim() || null,
    user_id: userId.trim() || null,
  });
}

/** Importa configuración desde archivo. mode: "merge" | "replace" */
export async function importConfigFromFile(
  path: string,
  mode: "merge" | "replace"
): Promise<void> {
  await invoke("import_config_from_file", { path, mode });
}

/** Elimina un juego (o una ruta concreta) de la configuración */
export async function removeGame(gameId: string, path?: string): Promise<void> {
  await invoke("remove_game", { gameId, path });
}

/** Escanea el sistema en busca de carpetas candidatas para guardados */
export async function scanPathCandidates(): Promise<PathCandidate[]> {
  return invoke<PathCandidate[]>("scan_path_candidates");
}

/** Resultado de subida o descarga */
export interface SyncResult {
  okCount: number;
  errCount: number;
  errors: string[];
}

/** Sube los guardados de un juego a la nube */
export async function syncUploadGame(gameId: string): Promise<SyncResult> {
  const r = await invoke<{
    okCount: number;
    errCount: number;
    errors: string[];
  }>("sync_upload_game", { gameId });
  return {
    okCount: r.okCount,
    errCount: r.errCount,
    errors: r.errors,
  };
}

/** Información de un guardado en la nube */
export interface RemoteSaveInfo {
  gameId: string;
  key: string;
  filename: string;
  lastModified: string;
  size?: number;
}

/** Lista todos los guardados del usuario en la nube (para última sincronización, etc.) */
export async function syncListRemoteSaves(): Promise<RemoteSaveInfo[]> {
  return invoke<RemoteSaveInfo[]>("sync_list_remote_saves");
}

/** Conflicto de descarga: archivo local más reciente que en la nube */
export interface DownloadConflict {
  filename: string;
  localModified: string;
  cloudModified: string;
}

/** Comprueba si hay conflictos (archivos locales más recientes que en la nube) */
export async function syncCheckDownloadConflicts(
  gameId: string
): Promise<{ conflicts: DownloadConflict[] }> {
  return invoke<{ conflicts: DownloadConflict[] }>(
    "sync_check_download_conflicts",
    { gameId }
  );
}

/** Juegos con guardados locales no subidos a la nube */
export interface UnsyncedGame {
  gameId: string;
}

/** Estadísticas por juego (tamaño local, últimas modificaciones) */
export interface GameStats {
  gameId: string;
  localSizeBytes: number;
  localLastModified: string | null;
  cloudLastModified: string | null;
}

/** Obtiene estadísticas de todos los juegos configurados */
export async function getGameStats(): Promise<GameStats[]> {
  return invoke<GameStats[]>("get_game_stats");
}

/** Comprueba qué juegos tienen guardados nuevos sin subir */
export async function syncCheckUnsyncedGames(): Promise<UnsyncedGame[]> {
  return invoke<UnsyncedGame[]>("sync_check_unsynced_games");
}

/** Descarga los guardados de un juego desde la nube */
export async function syncDownloadGame(gameId: string): Promise<SyncResult> {
  const r = await invoke<{
    okCount: number;
    errCount: number;
    errors: string[];
  }>("sync_download_game", { gameId });
  return {
    okCount: r.okCount,
    errCount: r.errCount,
    errors: r.errors,
  };
}

/** Información de un backup local */
export interface BackupInfo {
  id: string;
  createdAt: string;
  fileCount: number;
}

/** Lista los backups locales de un juego */
export async function listBackups(gameId: string): Promise<BackupInfo[]> {
  return invoke<BackupInfo[]>("list_backups", { gameId });
}

/** Restaura un backup local sobre los guardados del juego */
export async function restoreBackup(
  gameId: string,
  backupId: string
): Promise<SyncResult> {
  const r = await invoke<{
    okCount: number;
    errCount: number;
    errors: string[];
  }>("restore_backup", { gameId, backupId });
  return {
    okCount: r.okCount,
    errCount: r.errCount,
    errors: r.errors,
  };
}

/** Archivo en la previsualización */
export interface PreviewFile {
  filename: string;
  size: number;
  localNewer?: boolean;
}

/** Previsualización de subida */
export interface PreviewUpload {
  fileCount: number;
  totalSizeBytes: number;
  files: PreviewFile[];
}

/** Previsualización de descarga */
export interface PreviewDownload {
  fileCount: number;
  totalSizeBytes: number;
  files: PreviewFile[];
  conflictCount: number;
}

/** Previsualiza qué archivos se subirían */
export async function previewUpload(gameId: string): Promise<PreviewUpload> {
  return invoke<PreviewUpload>("preview_upload", { gameId });
}

/** Previsualiza qué archivos se descargarían */
export async function previewDownload(
  gameId: string
): Promise<PreviewDownload> {
  return invoke<PreviewDownload>("preview_download", { gameId });
}
