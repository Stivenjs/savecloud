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
  getDownloadUrl(userId: string, gameId: string, key: string): Promise<string>;
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
}
