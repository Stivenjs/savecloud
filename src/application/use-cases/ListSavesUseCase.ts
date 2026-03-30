import type { GameSave } from "@domain/entities/GameSave";
import type { SaveRepository } from "@domain/ports/SaveRepository";
import { TtlCache } from "@shared/ttlCache";

export interface ListSavesInput {
  userId: string;
  /**
   * Identificador de juego opcional.
   *
   * Cuando se especifica, el repositorio puede optimizar la consulta usando
   * un prefijo más específico (`userId/gameId/`) en lugar de recorrer todos
   * los objetos del usuario.
   */
  gameId?: string;
}

export type ListSavesOutput = GameSave[];

/**
 * Caso de uso: listar guardados de un usuario (opcionalmente filtrados por juego).
 */
export class ListSavesUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: ListSavesInput): Promise<ListSavesOutput> {
    const gameId = input.gameId?.trim();
    if (gameId) {
      const key = `${input.userId}::${gameId}`;
      const cached = listByUserAndGameCache.get(key);
      if (cached) return cached;
      const saves = await this.saveRepository.listByUserAndGame(input.userId, gameId);
      listByUserAndGameCache.set(key, saves);
      return saves;
    }
    return this.saveRepository.listByUser(input.userId);
  }
}

// Cache por instancia: evita repetir listados del mismo juego en refrescos frecuentes de UI.
const listByUserAndGameCache = new TtlCache<string, GameSave[]>({ ttlMs: 20_000, maxEntries: 300 });

/**
 * Invalida la caché de listados filtrados por juego.
 *
 * - Si se pasa `gameId`, invalida solo esa clave.
 * - Si no se pasa, invalida todas las claves del usuario.
 */
export function invalidateListSavesByGameCache(userId: string, gameId?: string): void {
  const trimmedUserId = userId.trim();
  if (!trimmedUserId) return;

  const trimmedGameId = gameId?.trim();
  if (trimmedGameId) {
    listByUserAndGameCache.delete(`${trimmedUserId}::${trimmedGameId}`);
    return;
  }

  // Invalida por prefijo de usuario.
  for (const key of listByUserAndGameCache.keys()) {
    if (key.startsWith(`${trimmedUserId}::`)) {
      listByUserAndGameCache.delete(key);
    }
  }
}
