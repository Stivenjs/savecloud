import { invoke } from "@tauri-apps/api/core";

/** Resultado de subida o descarga */
export interface SyncResult {
  okCount: number;
  errCount: number;
  errors: string[];
}

export interface ActiveDownloadState {
  id: string;
  kind: "upload" | "download";
  gameId: string | null;
  name: string;
  state: "queued" | "running" | "paused" | "completed" | "failed";
  loaded: number;
  total: number;
}

/** Resultado por juego de una operación batch (subir/descargar todos). */
export interface GameSyncResult {
  gameId: string;
  result: SyncResult;
}

export interface PausedUploadInfo {
  gameId: string;
  filename: string;
}

/** Plan de copia de archivos desde un amigo (manejo avanzado de conflictos) */
export interface CopyFriendFilePlan {
  key: string;
  filename: string;
  targetFilename: string;
}

/** Información de un guardado en la nube */
export interface RemoteSaveInfo {
  gameId: string;
  key: string;
  filename: string;
  lastModified: string;
  size?: number;
}

/** Resumen agregado de guardados en la nube por juego (para UI y “última sync”). */
export interface CloudSavesSummary {
  gameId: string;
  fileCount: number;
  totalSizeBytes: number;
  lastModified: string | null;
}

/** Conflicto de descarga: archivo local más reciente que en la nube */
export interface DownloadConflict {
  filename: string;
  localModified: string;
  cloudModified: string;
}

/** Juegos con guardados locales no subidos a la nube */
export interface UnsyncedGame {
  gameId: string;
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

/** Entrada del historial de operaciones (subidas, descargas, copias de amigos) */
export interface OperationLogEntry {
  timestamp: string;
  kind: "upload" | "download" | "copy_friend";
  gameId: string;
  fileCount: number;
  errCount: number;
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

/** Sube los guardados de todos los juegos a la nube (operación batch). */
export async function syncUploadAllGames(): Promise<GameSyncResult[]> {
  const list = await invoke<{ gameId: string; result: SyncResult }[]>("sync_upload_all_games");
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

/** Devuelve la info de la subida pausada, si existe (para mostrar "Reanudar" en la UI). */
export function getPausedUploadInfo(): Promise<PausedUploadInfo | null> {
  return invoke<PausedUploadInfo | null>("get_paused_upload_info");
}

/** Reanuda la subida multipart guardada tras pausar. */
export function syncUploadResume(): Promise<SyncResult> {
  return invoke<{ okCount: number; errCount: number; errors: string[] }>("sync_upload_resume").then((r) => ({
    okCount: r.okCount,
    errCount: r.errCount,
    errors: r.errors,
  }));
}

/** Copia los guardados de un amigo para un juego concreto a tu cuenta */
export async function copyFriendSaves(friendUserId: string, gameId: string): Promise<SyncResult> {
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

/** Lista todos los guardados del usuario en la nube (para última sincronización, etc.) */
export async function syncListRemoteSaves(): Promise<RemoteSaveInfo[]> {
  return invoke<RemoteSaveInfo[]>("sync_list_remote_saves");
}

/** Resumen agregado por juego (más rápido que listar todos los archivos). */
export async function syncListRemoteSavesSummary(): Promise<CloudSavesSummary[]> {
  return invoke<CloudSavesSummary[]>("sync_list_remote_saves_summary");
}

/** Lista todos los guardados en la nube de otro usuario (amigo) */
export async function syncListRemoteSavesForUser(userId: string): Promise<RemoteSaveInfo[]> {
  return invoke<RemoteSaveInfo[]>("sync_list_remote_saves_for_user", {
    userId,
  });
}

/** Comprueba si hay conflictos (archivos locales más recientes que en la nube) */
export async function syncCheckDownloadConflicts(gameId: string): Promise<{ conflicts: DownloadConflict[] }> {
  return invoke<{ conflicts: DownloadConflict[] }>("sync_check_download_conflicts", { gameId });
}

/** Comprueba conflictos de descarga para varios juegos en una sola llamada */
export async function syncCheckDownloadConflictsBatch(
  gameIds: string[]
): Promise<{ gameId: string; conflicts: DownloadConflict[] }[]> {
  if (gameIds.length === 0) return [];
  return invoke<{ gameId: string; conflicts: DownloadConflict[] }[]>("sync_check_download_conflicts_batch", {
    gameIds,
  });
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
  const list = await invoke<{ gameId: string; result: SyncResult }[]>("sync_download_all_games");
  return list.map(({ gameId, result }) => ({
    gameId,
    result: {
      okCount: result.okCount,
      errCount: result.errCount,
      errors: result.errors,
    },
  }));
}

/** Snapshot de descargas activas para rehidratar la UI al iniciar. */
export async function getActiveDownloadsState(): Promise<ActiveDownloadState[]> {
  return invoke<ActiveDownloadState[]>("get_active_downloads_state");
}

/** Previsualiza qué archivos se subirían */
export async function previewUpload(gameId: string): Promise<PreviewUpload> {
  return invoke<PreviewUpload>("preview_upload", { gameId });
}

/** Previsualiza qué archivos se subirían para varios juegos en lote (batch) */
export async function previewUploadBatch(gameIds: string[]): Promise<Record<string, PreviewUpload>> {
  if (gameIds.length === 0) return {};
  return invoke<Record<string, PreviewUpload>>("preview_upload_batch", { gameIds });
}

/** Previsualiza qué archivos se descargarían */
export async function previewDownload(gameId: string): Promise<PreviewDownload> {
  return invoke<PreviewDownload>("preview_download", { gameId });
}

/** Borra todos los guardados del juego en la nube (S3). Por defecto mueve a papelera a menos que permanent sea true. */
export async function deleteGameFromCloud(gameId: string, permanent?: boolean): Promise<void> {
  await invoke("sync_delete_game_from_cloud", { gameId, permanent: permanent ?? false });
}

/** Renombra un juego en la nube (copia a nuevo id y borra el prefijo antiguo) */
export async function renameGameInCloud(oldGameId: string, newGameId: string): Promise<void> {
  await invoke("sync_rename_game_in_cloud", {
    oldGameId,
    newGameId,
  });
}

/** Indica si la API devuelve URLs con S3 Transfer Acceleration ("accelerated" | "standard" | "unknown"). */
export async function getS3TransferEndpointType(): Promise<"accelerated" | "standard" | "unknown"> {
  const result = await invoke<string>("get_s3_transfer_endpoint_type");
  if (result === "accelerated" || result === "standard") return result;
  return "unknown";
}

/** Lista el historial de operaciones */
export async function listOperationHistory(): Promise<OperationLogEntry[]> {
  return invoke<OperationLogEntry[]>("list_operation_history");
}
