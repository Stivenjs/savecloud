import type { GameSave } from "@domain/entities/GameSave";

export interface UploadUrlItem {
  gameId: string;
  filename: string;
}

export interface UploadUrlResult {
  uploadUrl: string;
  key: string;
  gameId: string;
  filename: string;
}

export interface DownloadUrlItem {
  gameId: string;
  key: string;
}

export interface DownloadUrlResult {
  downloadUrl: string;
  gameId: string;
  key: string;
}

/** Metadato de un backup (archivo .tar) subido para un juego. */
export interface BackupMetadata {
  key: string;
  lastModified: Date;
  size?: number;
  /** Nombre del archivo (ej. backups/2026-03-08_12-00-00.tar). */
  filename: string;
}

/** Resultado de iniciar una subida multipart (archivos grandes, pausable/cancelable). */
export interface CreateMultipartUploadResult {
  uploadId: string;
  key: string;
}

/** Par de número de parte y URL firmada para subir esa parte. */
export interface UploadPartUrl {
  partNumber: number;
  url: string;
}

/** Parte completada (ETag devuelto por S3 al subir la parte). */
export interface CompletedPart {
  partNumber: number;
  etag: string;
}

/**
 * Puerto (interface) para persistencia de guardados.
 * La capa de aplicación depende de este contrato; la implementación vive en infrastructure.
 */
export interface SaveRepository {
  getUploadUrl(
    userId: string,
    gameId: string,
    filename: string
  ): Promise<string>;
  getDownloadUrl(
    userId: string,
    gameId: string,
    key: string,
    range?: { start: number; end: number }
  ): Promise<string>;
  /** Varias URLs de subida en una sola llamada (menos round-trips y una sola invocación Lambda). */
  getUploadUrls(
    userId: string,
    items: UploadUrlItem[]
  ): Promise<UploadUrlResult[]>;
  /** Varias URLs de descarga en una sola llamada. */
  getDownloadUrls(
    userId: string,
    items: DownloadUrlItem[]
  ): Promise<DownloadUrlResult[]>;
  listByUser(userId: string): Promise<GameSave[]>;
  /** Lista backups (archivos .tar) del juego bajo userId/gameId/backups/ */
  listBackups(userId: string, gameId: string): Promise<BackupMetadata[]>;
  /** Borra un backup por key (debe estar bajo userId/gameId/backups/). */
  deleteBackup(userId: string, gameId: string, key: string): Promise<void>;
  /** Renombra un backup: copia a userId/gameId/backups/newFilename y borra el antiguo. */
  renameBackup(
    userId: string,
    gameId: string,
    oldKey: string,
    newFilename: string
  ): Promise<void>;
  /** Borra todos los objetos en S3 bajo userId/gameId/ */
  deleteGame(userId: string, gameId: string): Promise<void>;
  /** Copia todos los objetos de userId/oldGameId/ a userId/newGameId/ y borra los antiguos */
  renameGame(
    userId: string,
    oldGameId: string,
    newGameId: string
  ): Promise<void>;

  // --- Multipart upload (archivos grandes, pausar/cancelar) ---
  /** Inicia una subida multipart; devuelve uploadId y key para las siguientes llamadas. */
  createMultipartUpload(
    userId: string,
    gameId: string,
    filename: string
  ): Promise<CreateMultipartUploadResult>;
  /**
   * Inicia multipart y devuelve además las URLs de todas las partes en una sola llamada (menos invocaciones Lambda).
   * partCount: número de partes (1-based), máx. recomendado ~2000 por límites de tiempo/respuesta.
   */
  createMultipartUploadWithPartUrls(
    userId: string,
    gameId: string,
    filename: string,
    partCount: number
  ): Promise<CreateMultipartUploadResult & { partUrls: UploadPartUrl[] }>;
  /** URLs firmadas para subir cada parte (partNumbers 1-based). El cliente hace PUT a cada URL. */
  getUploadPartUrls(
    key: string,
    uploadId: string,
    partNumbers: number[]
  ): Promise<UploadPartUrl[]>;
  /** Completa la subida multipart con los ETags devueltos por S3 al subir cada parte. */
  completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: CompletedPart[]
  ): Promise<void>;
  /** Cancela la subida multipart y libera recursos en S3. */
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
}
