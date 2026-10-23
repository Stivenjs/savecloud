import type { GameSave } from "@domain/entities/GameSave";
import type { SaveFileIndexRepository } from "@domain/ports/SaveFileIndexRepository";
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
  constructor(
    private readonly saveRepository: SaveRepository,
    private readonly saveFileIndexRepository?: SaveFileIndexRepository
  ) {}

  async execute(input: ListSavesInput): Promise<ListSavesOutput> {
    const gameId = input.gameId?.trim();
    if (gameId) {
      const key = `${input.userId}::${gameId}`;
      const cached = listByUserAndGameCache.get(key);
      if (cached) return cached;

      // Usa DynamoDB cuando hay indice; cae a S3 si el indice aun no fue poblado.
      let saves =
        this.saveFileIndexRepository && (await this.saveFileIndexRepository.listByUserAndGame(input.userId, gameId));
      if (!saves || saves.length === 0) {
        saves = await this.saveRepository.listByUserAndGame(input.userId, gameId);
      }

      listByUserAndGameCache.set(key, saves);
      return saves;
    }

    const saveFileIndexRepository = this.saveFileIndexRepository;
    if (!saveFileIndexRepository) return this.saveRepository.listByUser(input.userId);

    return getOrLoadUserSaves(input.userId, async () => {
      const saves = await saveFileIndexRepository.listByUser(input.userId);
      return saves.length > 0 ? saves : this.saveRepository.listByUser(input.userId);
    });
  }
}

// Cachés por instancia: reducen consultas repetidas sin mantener datos mucho tiempo.
const listByUserAndGameCache = new TtlCache<string, GameSave[]>({ ttlMs: 10_000, maxEntries: 300 });
const listByUserCache = new TtlCache<string, GameSave[]>({ ttlMs: 500, maxEntries: 300 });
const listByUserInFlight = new Map<string, { promise: Promise<GameSave[]>; invalidated: boolean }>();

async function getOrLoadUserSaves(userId: string, loader: () => Promise<GameSave[]>): Promise<GameSave[]> {
  const cached = listByUserCache.get(userId);
  if (cached) return cached;

  const pending = listByUserInFlight.get(userId);
  if (pending) return pending.promise;

  const request = { promise: Promise.resolve([] as GameSave[]), invalidated: false };
  request.promise = Promise.resolve().then(loader);
  listByUserInFlight.set(userId, request);

  try {
    const saves = await request.promise;
    if (!request.invalidated) listByUserCache.set(userId, saves);
    return saves;
  } finally {
    if (listByUserInFlight.get(userId) === request) listByUserInFlight.delete(userId);
  }
}

/**
 * Invalida las cachés de listados del usuario.
 *
 * - Si se pasa `gameId`, invalida solo esa clave.
 * - Si no se pasa, invalida todas las claves del usuario.
 */
export function invalidateListSavesByGameCache(userId: string, gameId?: string): void {
  const trimmedUserId = userId.trim();
  if (!trimmedUserId) return;

  listByUserCache.delete(trimmedUserId);
  const pendingUserList = listByUserInFlight.get(trimmedUserId);
  if (pendingUserList) pendingUserList.invalidated = true;

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
