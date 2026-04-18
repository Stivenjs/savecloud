import type { GameSave } from "@domain/entities/GameSave";

/**
 * Puerto para el indice de archivos remotos (metadatos por archivo).
 * Permite responder listados de /saves sin recorrer todo S3.
 */
export interface SaveFileIndexRepository {
  listByUser(userId: string): Promise<GameSave[]>;
  listByUserAndGame(userId: string, gameId: string): Promise<GameSave[]>;
  upsert(input: {
    userId: string;
    gameId: string;
    objectKey: string;
    size?: number;
    lastModified?: Date;
  }): Promise<void>;
  delete(userId: string, objectKey: string): Promise<void>;
}
