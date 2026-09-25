import { invoke } from "@tauri-apps/api/core";
import type { SyncResult } from "./sync-cloud.service";

/** Información de un backup local */
export interface BackupInfo {
  id: string;
  createdAt: string;
  fileCount: number;
}

/** Información de un backup completo en la nube (un .tar por juego) */
export interface CloudBackupInfo {
  key: string;
  lastModified: string;
  size?: number;
  filename: string;
}

/** Resultado de la limpieza de backups antiguos */
export interface CleanupBackupsResult {
  backupsDeleted: number;
  gamesAffected: number;
}

/** Lista los backups locales de un juego */
export async function listBackups(gameId: string): Promise<BackupInfo[]> {
  return invoke<BackupInfo[]>("list_backups", { gameId });
}

/** Restaura un backup local sobre los guardados del juego */
export async function restoreBackup(gameId: string, backupId: string): Promise<SyncResult> {
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

/** Elimina backups antiguos: mantiene solo los últimos N por juego. Devuelve cuántos se borraron. */
export async function cleanupOldBackups(keepLastN: number): Promise<CleanupBackupsResult> {
  return invoke<CleanupBackupsResult>("cleanup_old_backups", {
    keepLastN,
  });
}

/** Guarda en config cuántos backups locales mantener por juego (usado por la UI y por la auto-limpieza). */
export async function setKeepBackupsPerGame(keepLastN: number): Promise<void> {
  await invoke("set_keep_backups_per_game", { keepLastN });
}

/** Elimina todos los backups locales (carpeta SaveCloud/backups completa). */
export async function deleteAllLocalBackups(): Promise<void> {
  await invoke("delete_all_local_backups");
}

/** Crea un .tar de la carpeta del juego y lo sube a la nube (recomendado para juegos grandes). */
export async function createAndUploadFullBackup(gameId: string): Promise<string> {
  return invoke<string>("create_and_upload_full_backup", { gameId });
}

/** Lista los backups completos en la nube para un juego. */
export async function listFullBackups(gameId: string): Promise<CloudBackupInfo[]> {
  return invoke<CloudBackupInfo[]>("list_full_backups", { gameId });
}

/** Lista los backups en la nube para varios juegos en una sola invocación. */
export async function listFullBackupsBatch(gameIds: string[]): Promise<Record<string, CloudBackupInfo[]>> {
  const ids = gameIds.filter((id) => id?.trim());
  if (!ids.length) return {};
  return invoke<Record<string, CloudBackupInfo[]>>("list_full_backups_batch", {
    gameIds: ids,
  });
}

/** Descarga un backup completo por key y lo extrae en la carpeta del juego. */
export async function downloadAndRestoreFullBackup(gameId: string, backupKey: string): Promise<void> {
  await invoke("download_and_restore_full_backup", {
    gameId,
    backupKey,
  });
}

/** Elimina un backup empaquetado de la nube por key. */
export async function deleteFullBackup(gameId: string, backupKey: string): Promise<void> {
  await invoke("delete_cloud_backup", { gameId, backupKey });
}

/** Renombra un backup empaquetado en la nube. newFilename debe ser solo el nombre .tar (ej. "mi-backup.tar"). */
export async function renameFullBackup(gameId: string, backupKey: string, newFilename: string): Promise<void> {
  await invoke("rename_cloud_backup", {
    gameId,
    backupKey,
    newFilename,
  });
}

/** Experimental: activa/desactiva backup completo en streaming (sin .tar temporal). */
export async function setFullBackupStreaming(enabled: boolean): Promise<void> {
  await invoke("set_full_backup_streaming", { enabled });
}

/** Modo prueba: backup streaming sin subir a la nube. */
export async function setFullBackupStreamingDryRun(enabled: boolean): Promise<void> {
  await invoke("set_full_backup_streaming_dry_run", { enabled });
}

/** Nivel Zstd (1–22) para backup completo empaquetado en streaming; `null` restaura el predeterminado (5). */
export async function setFullBackupPackagedCompressionLevel(level: number | null): Promise<void> {
  await invoke("set_full_backup_packaged_compression_level", { level });
}

/** Métricas de simulación de streaming full backup (dry-run). */
export interface StreamingDryRunMetrics {
  gameId: string;
  filename: string;
  originalBytes: number;
  compressedBytes: number;
  savedBytes: number;
  savedRatio: number;
  savedPercentage: number;
  durationMs: number;
  throughputMbS: number;
  outputThroughputMbS: number;
  zstdLevel: number;
  threads: number;
  totalFiles: number;
  totalDirs: number;
  totalSymlinks: number;
  chunksCount: number;
  simulatedPartSize: number;
  simulatedPartsCount: number;
  timestamp?: number;
}

/** Ejecuta una prueba de compresión y empaquetado streaming (dry-run) sin subir datos a la nube. */
export async function testStreamingFullBackup(
  gameId: string,
  compressionLevel?: number | null
): Promise<StreamingDryRunMetrics> {
  return invoke<StreamingDryRunMetrics>("test_streaming_full_backup", {
    gameId,
    compressionLevel: compressionLevel ?? null,
  });
}
