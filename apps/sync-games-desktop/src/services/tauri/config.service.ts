import { invoke } from "@tauri-apps/api/core";
import type { Config } from "@app-types/config";

export interface PathCandidate {
  path: string;
  folderName: string;
  basePath: string;
  /** Steam App ID cuando se conoce (manifiesto o ruta Steam). */
  steamAppId?: string | null;
  /** Varias rutas de guardado para el mismo juego; al añadir se registran todas. */
  paths?: string[] | null;
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

/** Busca Steam App IDs para varias consultas en una sola operación batch (en paralelo en el backend). */
export async function searchSteamAppIdsBatch(
  queries: string[]
): Promise<(string | null)[]> {
  if (!queries.length) return [];
  const raw = await invoke<(string | null)[]>("search_steam_app_ids_batch", {
    queries,
  });
  return raw.map((v) => v ?? null);
}

/** Obtiene el nombre del juego a partir del Steam App ID (API appdetails) */
export async function getSteamAppName(appId: string): Promise<string | null> {
  return invoke<string | null>("get_steam_app_name", { appId });
}

/** Comprueba si un único juego está en ejecución (para mostrar advertencia) */
export function checkGameRunning(gameId: string): Promise<boolean> {
  return invoke<boolean>("check_game_running", { gameId });
}

/** Comprueba el estado de ejecución de varios juegos en una sola llamada */
export function checkGamesRunning(
  gameIds: readonly string[]
): Promise<Record<string, boolean>> {
  if (!gameIds.length) return Promise.resolve({});
  return invoke<Record<string, boolean>>("check_games_running", {
    gameIds,
  });
}

/** Añade un juego a la configuración */
export async function addGame(
  gameId: string,
  path: string,
  editionLabel?: string,
  sourceUrl?: string,
  steamAppId?: string,
  imageUrl?: string
): Promise<void> {
  await invoke("add_game", {
    gameId,
    path,
    editionLabel: editionLabel?.trim() || null,
    sourceUrl: sourceUrl?.trim() || null,
    steamAppId: steamAppId?.trim() || null,
    imageUrl: imageUrl?.trim() || null,
  });
}

export interface ManifestSearchResult {
  steamAppId: string;
  name: string;
}

/** Busca juegos en Steam por nombre (sugerencias rápidas) */
export async function searchSteamGames(
  query: string
): Promise<ManifestSearchResult[]> {
  if (!query.trim()) return [];
  return invoke<ManifestSearchResult[]>("search_steam_games", { query });
}

/** Abre la carpeta de guardados del juego en el explorador */
export async function openSaveFolder(gameId: string): Promise<void> {
  await invoke("open_save_folder", { gameId });
}

/** Exporta la configuración a un archivo JSON. Devuelve el path. */
export async function exportConfigToFile(path: string): Promise<string> {
  return invoke("export_config_to_file", { path });
}

/** Sube config.json a la nube como "__config__/config.json" */
export async function backupConfigToCloud(): Promise<void> {
  await invoke("backup_config_to_cloud");
}

const CONFIG_BACKUP_DEBOUNCE_MS = 2500;
let configBackupTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Programa un respaldo del config a la nube tras un breve retraso.
 * Si se vuelve a llamar antes de que se ejecute, se reinicia el temporizador.
 * Útil para mantener la nube actualizada tras añadir/editar/eliminar juegos o cambiar configuración.
 */
export function scheduleConfigBackupToCloud(): void {
  if (configBackupTimeoutId) clearTimeout(configBackupTimeoutId);
  configBackupTimeoutId = setTimeout(() => {
    configBackupTimeoutId = null;
    backupConfigToCloud().catch(() => {
      // Fallo silencioso para no molestar; el usuario puede usar "Subir a la nube" manual.
    });
  }, CONFIG_BACKUP_DEBOUNCE_MS);
}

/** Restaura config.json desde la nube (última versión) */
export async function restoreConfigFromCloud(): Promise<void> {
  await invoke("restore_config_from_cloud");
}

/** Indica si la API devuelve URLs con S3 Transfer Acceleration ("accelerated" | "standard" | "unknown"). */
export async function getS3TransferEndpointType(): Promise<
  "accelerated" | "standard" | "unknown"
> {
  const result = await invoke<string>("get_s3_transfer_endpoint_type");
  if (result === "accelerated" || result === "standard") return result;
  return "unknown";
}

/** Obtiene la configuración de un amigo desde la nube (solo lectura) */
export async function getFriendConfig(
  friendUserId: string
): Promise<Config> {
  return invoke<Config>("get_friend_config", { friendUserId });
}

/** Añade a tu config solo los juegos del amigo que no tienes (por id). No modifica apiKey ni userId. */
export async function addGamesFromFriend(
  friendGames: readonly { id: string; paths: string[]; steamAppId?: string; imageUrl?: string; editionLabel?: string; sourceUrl?: string }[]
): Promise<number> {
  return invoke<number>("add_games_from_friend", {
    friendGames: [...friendGames],
  });
}

/** Crea o actualiza el archivo de configuración con apiBaseUrl, apiKey y userId. Devuelve la ruta del archivo. */
export async function createConfigFile(
  apiBaseUrl: string,
  apiKey: string,
  userId: string
): Promise<string> {
  return invoke<string>("create_config_file", {
    apiBaseUrl: apiBaseUrl.trim() || null,
    apiKey: apiKey.trim() || null,
    userId: userId.trim() || null,
  });
}

/** Importa configuración desde archivo. mode: "merge" | "replace" */
export async function importConfigFromFile(
  path: string,
  mode: "merge" | "replace"
): Promise<void> {
  await invoke("import_config_from_file", { path, mode });
}

/** Actualiza un juego existente (rutas y metadatos). */
export async function updateGame(
  gameId: string,
  paths: string[],
  editionLabel?: string,
  sourceUrl?: string,
  steamAppId?: string,
  imageUrl?: string
): Promise<void> {
  await invoke("update_game", {
    gameId,
    paths,
    editionLabel: editionLabel?.trim() || null,
    sourceUrl: sourceUrl?.trim() || null,
    steamAppId: steamAppId?.trim() || null,
    imageUrl: imageUrl?.trim() || null,
  });
}

/** Lee un archivo de imagen y devuelve su data URL (base64). Para portadas personalizadas. */
export async function readImageAsDataUrl(path: string): Promise<string> {
  return invoke<string>("read_image_as_data_url", { path });
}

/** Elimina un juego (o una ruta concreta) de la configuración */
export async function removeGame(gameId: string, path?: string): Promise<void> {
  await invoke("remove_game", { gameId, path });
}

/** Borra todos los guardados del juego en la nube (S3) */
export async function deleteGameFromCloud(gameId: string): Promise<void> {
  await invoke("sync_delete_game_from_cloud", { gameId });
}

/** Renombra un juego en la nube (copia a nuevo id y borra el prefijo antiguo) */
export async function renameGameInCloud(
  oldGameId: string,
  newGameId: string
): Promise<void> {
  await invoke("sync_rename_game_in_cloud", {
    oldGameId,
    newGameId,
  });
}

/** Renombra un juego en la configuración local (cambia su id) */
export async function renameGame(
  oldGameId: string,
  newGameId: string
): Promise<void> {
  await invoke("rename_game", { oldGameId, newGameId });
}

/** Entrada del historial de operaciones (subidas, descargas, copias de amigos) */
export interface OperationLogEntry {
  timestamp: string;
  kind: "upload" | "download" | "copy_friend";
  gameId: string;
  fileCount: number;
  errCount: number;
}

/** Lista el historial de operaciones */
export async function listOperationHistory(): Promise<OperationLogEntry[]> {
  return invoke<OperationLogEntry[]>("list_operation_history");
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

/** Resultado por juego de una operación batch (subir/descargar todos). */
export interface GameSyncResult {
  gameId: string;
  result: SyncResult;
}

/** Sube los guardados de todos los juegos a la nube (operación batch). */
export async function syncUploadAllGames(): Promise<GameSyncResult[]> {
  const list = await invoke<{ gameId: string; result: SyncResult }[]>(
    "sync_upload_all_games"
  );
  return list.map(({ gameId, result }) => ({
    gameId,
    result: {
      okCount: result.okCount,
      errCount: result.errCount,
      errors: result.errors,
    },
  }));
}

/** Solicita cancelar la subida en curso (solo tiene efecto en subidas multipart entre partes). */
export function requestUploadCancel(): Promise<void> {
  return invoke("request_upload_cancel");
}

/** Solicita pausar la subida en curso. El estado se guarda y se puede reanudar con syncUploadResume. */
export function requestUploadPause(): Promise<void> {
  return invoke("request_upload_pause");
}

export interface PausedUploadInfo {
  gameId: string;
  filename: string;
}

/** Devuelve la info de la subida pausada, si existe (para mostrar "Reanudar" en la UI). */
export function getPausedUploadInfo(): Promise<PausedUploadInfo | null> {
  return invoke<PausedUploadInfo | null>("get_paused_upload_info");
}

/** Reanuda la subida multipart guardada tras pausar. */
export function syncUploadResume(): Promise<SyncResult> {
  return invoke<{ okCount: number; errCount: number; errors: string[] }>(
    "sync_upload_resume"
  ).then((r) => ({
    okCount: r.okCount,
    errCount: r.errCount,
    errors: r.errors,
  }));
}

/** Copia los guardados de un amigo para un juego concreto a tu cuenta */
export async function copyFriendSaves(
  friendUserId: string,
  gameId: string
): Promise<SyncResult> {
  const r = await invoke<{
    okCount: number;
    errCount: number;
    errors: string[];
  }>("copy_friend_saves", { friendUserId, gameId });
  return {
    okCount: r.okCount,
    errCount: r.errCount,
    errors: r.errors,
  };
}

/** Plan de copia de archivos desde un amigo (manejo avanzado de conflictos) */
export interface CopyFriendFilePlan {
  key: string;
  filename: string;
  targetFilename: string;
}

/** Copia los guardados de un amigo usando un plan detallado (permite omitir/renombrar) */
export async function copyFriendSavesWithPlan(
  friendUserId: string,
  gameId: string,
  plan: CopyFriendFilePlan[]
): Promise<SyncResult> {
  const r = await invoke<{
    okCount: number;
    errCount: number;
    errors: string[];
  }>("copy_friend_saves_with_plan", { friendUserId, gameId, plan });
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

/** Lista todos los guardados en la nube de otro usuario (amigo) */
export async function syncListRemoteSavesForUser(
  userId: string
): Promise<RemoteSaveInfo[]> {
  return invoke<RemoteSaveInfo[]>("sync_list_remote_saves_for_user", {
    userId,
  });
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

/** Comprueba conflictos de descarga para varios juegos en una sola llamada */
export async function syncCheckDownloadConflictsBatch(
  gameIds: string[]
): Promise<{ gameId: string; conflicts: DownloadConflict[] }[]> {
  if (gameIds.length === 0) return [];
  return invoke<{ gameId: string; conflicts: DownloadConflict[] }[]>(
    "sync_check_download_conflicts_batch",
    { gameIds }
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

/** Descarga los guardados de todos los juegos desde la nube (operación batch). */
export async function syncDownloadAllGames(): Promise<GameSyncResult[]> {
  const list = await invoke<{ gameId: string; result: SyncResult }[]>(
    "sync_download_all_games"
  );
  return list.map(({ gameId, result }) => ({
    gameId,
    result: {
      okCount: result.okCount,
      errCount: result.errCount,
      errors: result.errors,
    },
  }));
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

/** Información de un backup completo en la nube (un .tar por juego) */
export interface CloudBackupInfo {
  key: string;
  lastModified: string;
  size?: number;
  filename: string;
}

/** Crea un .tar de la carpeta del juego y lo sube a la nube (recomendado para juegos grandes). */
export async function createAndUploadFullBackup(gameId: string): Promise<string> {
  return invoke<string>("create_and_upload_full_backup", { gameId });
}

/** Lista los backups completos en la nube para un juego. */
export async function listFullBackups(
  gameId: string
): Promise<CloudBackupInfo[]> {
  return invoke<CloudBackupInfo[]>("list_full_backups", { gameId });
}

/** Descarga un backup completo por key y lo extrae en la carpeta del juego. */
export async function downloadAndRestoreFullBackup(
  gameId: string,
  backupKey: string
): Promise<void> {
  await invoke("download_and_restore_full_backup", {
    gameId,
    backupKey,
  });
}

/** Elimina un backup empaquetado de la nube por key. */
export async function deleteFullBackup(
  gameId: string,
  backupKey: string
): Promise<void> {
  await invoke("delete_cloud_backup", { gameId, backupKey });
}

/** Renombra un backup empaquetado en la nube. newFilename debe ser solo el nombre .tar (ej. "mi-backup.tar"). */
export async function renameFullBackup(
  gameId: string,
  backupKey: string,
  newFilename: string
): Promise<void> {
  await invoke("rename_cloud_backup", {
    gameId,
    backupKey,
    newFilename,
  });
}

/** Resultado de la limpieza de backups antiguos */
export interface CleanupBackupsResult {
  backupsDeleted: number;
  gamesAffected: number;
}

/** Elimina backups antiguos: mantiene solo los últimos N por juego. Devuelve cuántos se borraron. */
export async function cleanupOldBackups(
  keepLastN: number
): Promise<CleanupBackupsResult> {
  return invoke<CleanupBackupsResult>("cleanup_old_backups", {
    keepLastN,
  });
}

/** Guarda en config cuántos backups locales mantener por juego (usado por la UI y por la auto-limpieza). */
export async function setKeepBackupsPerGame(keepLastN: number): Promise<void> {
  await invoke("set_keep_backups_per_game", { keepLastN });
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
