import type { GameSave } from "@domain/entities/GameSave";

export type SaveFileIndexMutation =
  | {
      type: "put";
      userId: string;
      gameId: string;
      objectKey: string;
      size?: number;
      lastModified?: Date;
    }
  | { type: "delete"; userId: string; objectKey: string };

/**
 * Puerto para el indice de archivos remotos (metadatos por archivo).
 * Permite responder listados de /saves sin recorrer todo S3.
 */
export interface SaveFileIndexRepository {
  listByUser(userId: string): Promise<GameSave[]>;
  listByUserAndGame(userId: string, gameId: string): Promise<GameSave[]>;
  getByObjectKey(userId: string, objectKey: string): Promise<GameSave | null>;
  upsert(input: {
    userId: string;
    gameId: string;
    objectKey: string;
    size?: number;
    lastModified?: Date;
  }): Promise<void>;
  delete(userId: string, objectKey: string): Promise<void>;
  /** Operaciones optimizadas disponibles en adaptadores compatibles con lotes DynamoDB. */
  batchGetByObjectKeys?(userId: string, objectKeys: string[]): Promise<Map<string, GameSave>>;
  batchApplyMutations?(mutations: SaveFileIndexMutation[]): Promise<void>;
}
