import type { SQL } from "bun";
import type { GameSave } from "@domain/entities/GameSave";
import type { SaveFileIndexMutation, SaveFileIndexRepository } from "@domain/ports/SaveFileIndexRepository";

const BATCH_GET_SIZE = 500;
const BATCH_WRITE_SIZE = 500;

interface SaveFileIndexRow {
  user_id: string;
  object_key: string;
  game_id: string;
  size: number | string | null;
  last_modified: Date | string | null;
}

interface SaveFileIndexWriteRow {
  user_id: string;
  object_key: string;
  game_id: string;
  size: number | null;
  last_modified: Date | null;
}

/** Persistencia PostgreSQL de los metadatos indexados para archivos de guardado en S3. */
export class PostgresSaveFileIndexRepository implements SaveFileIndexRepository {
  /** Crea el adaptador con el pool PostgreSQL compartido por la API. */
  constructor(private readonly sql: SQL) {}

  /** Lista todos los archivos indexados de un usuario en el orden de la clave S3. */
  async listByUser(userId: string): Promise<GameSave[]> {
    const cleanUserId = userId.trim();
    if (!cleanUserId) return [];

    const rows = await this.sql<SaveFileIndexRow[]>`
      SELECT user_id, object_key, game_id, size, last_modified
      FROM savecloud_save_file_index
      WHERE user_id = ${cleanUserId}
      ORDER BY object_key ASC
    `;

    return rows.map(mapRowToGameSave);
  }

  /** Lista los archivos indexados de un juego mediante el prefijo de su clave S3. */
  async listByUserAndGame(userId: string, gameId: string): Promise<GameSave[]> {
    const cleanUserId = userId.trim();
    const cleanGameId = gameId.trim();
    if (!cleanUserId || !cleanGameId) return [];

    const rows = await this.sql<SaveFileIndexRow[]>`
      SELECT user_id, object_key, game_id, size, last_modified
      FROM savecloud_save_file_index
      WHERE user_id = ${cleanUserId} AND game_id = ${cleanGameId}
      ORDER BY object_key ASC
    `;

    return rows.map(mapRowToGameSave);
  }

  /** Busca los metadatos de un objeto S3 para un usuario. */
  async getByObjectKey(userId: string, objectKey: string): Promise<GameSave | null> {
    const cleanUserId = userId.trim();
    if (!cleanUserId || !objectKey) return null;

    const rows = await this.sql<SaveFileIndexRow[]>`
      SELECT user_id, object_key, game_id, size, last_modified
      FROM savecloud_save_file_index
      WHERE user_id = ${cleanUserId} AND object_key = ${objectKey}
      LIMIT 1
    `;

    const row = rows[0];
    return row ? mapRowToGameSave(row) : null;
  }

  /** Lee en una sola consulta los objetos de un usuario, ignorando claves repetidas. */
  async batchGetByObjectKeys(userId: string, objectKeys: string[]): Promise<Map<string, GameSave>> {
    const cleanUserId = userId.trim();
    const uniqueKeys = [...new Set(objectKeys.filter(Boolean))];
    const savesByKey = new Map<string, GameSave>();
    if (!cleanUserId || uniqueKeys.length === 0) return savesByKey;

    for (let offset = 0; offset < uniqueKeys.length; offset += BATCH_GET_SIZE) {
      const batch = uniqueKeys.slice(offset, offset + BATCH_GET_SIZE);
      const rows = await this.sql<SaveFileIndexRow[]>`
        SELECT user_id, object_key, game_id, size, last_modified
        FROM savecloud_save_file_index
        WHERE user_id = ${cleanUserId} AND object_key IN ${this.sql(batch)}
      `;

      for (const row of rows) {
        const save = mapRowToGameSave(row);
        savesByKey.set(save.key, save);
      }
    }

    return savesByKey;
  }

  /** Inserta o actualiza un registro usando la clave compuesta usuario/objeto. */
  async upsert(input: {
    userId: string;
    gameId: string;
    objectKey: string;
    size?: number;
    lastModified?: Date;
  }): Promise<void> {
    await this.upsertRows([toWriteRow(input)]);
  }

  /** Elimina un objeto indexado de un usuario. */
  async delete(userId: string, objectKey: string): Promise<void> {
    const cleanUserId = userId.trim();
    if (!cleanUserId || !objectKey) return;

    await this.sql`
      DELETE FROM savecloud_save_file_index
      WHERE user_id = ${cleanUserId} AND object_key = ${objectKey}
    `;
  }

  /** Lee los registros de varios objetos y aplica sus cambios con UPSERT y DELETE por lote. */
  async batchApplyMutations(mutations: SaveFileIndexMutation[]): Promise<void> {
    if (mutations.length === 0) return;

    const latestMutationByKey = new Map<string, SaveFileIndexMutation>();
    for (const mutation of mutations) {
      latestMutationByKey.set(`${mutation.userId}\u0000${mutation.objectKey}`, mutation);
    }

    const upserts: SaveFileIndexWriteRow[] = [];
    const deletesByUser = new Map<string, Set<string>>();
    for (const mutation of latestMutationByKey.values()) {
      if (mutation.type === "put") {
        upserts.push(toWriteRow(mutation));
        continue;
      }

      const userKeys = deletesByUser.get(mutation.userId) ?? new Set<string>();
      userKeys.add(mutation.objectKey);
      deletesByUser.set(mutation.userId, userKeys);
    }

    await this.upsertRows(upserts);
    await this.deleteByUserAndObjectKeys(deletesByUser);
  }

  private async upsertRows(rows: SaveFileIndexWriteRow[]): Promise<void> {
    for (let offset = 0; offset < rows.length; offset += BATCH_WRITE_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_WRITE_SIZE);
      const values: Array<Record<string, unknown>> = batch.map((row) => ({
        user_id: row.user_id,
        object_key: row.object_key,
        game_id: row.game_id,
        size: row.size,
        last_modified: row.last_modified,
      }));
      await this.sql`
        INSERT INTO savecloud_save_file_index
        ${this.sql(values, "user_id", "object_key", "game_id", "size", "last_modified")}
        ON CONFLICT (user_id, object_key) DO UPDATE SET
          game_id = EXCLUDED.game_id,
          size = EXCLUDED.size,
          last_modified = EXCLUDED.last_modified
      `;
    }
  }

  private async deleteByUserAndObjectKeys(keysByUser: Map<string, Set<string>>): Promise<void> {
    for (const [userId, keys] of keysByUser) {
      const uniqueKeys = [...keys];
      for (let offset = 0; offset < uniqueKeys.length; offset += BATCH_GET_SIZE) {
        const batch = uniqueKeys.slice(offset, offset + BATCH_GET_SIZE);
        await this.sql`
          DELETE FROM savecloud_save_file_index
          WHERE user_id = ${userId} AND object_key IN ${this.sql(batch)}
        `;
      }
    }
  }
}

/** Crea la tabla y los índices utilizados por las consultas del índice de archivos. */
export async function ensurePostgresSaveFileIndexSchema(sql: SQL): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS savecloud_save_file_index (
      user_id text NOT NULL,
      object_key text NOT NULL,
      game_id text NOT NULL,
      size bigint,
      last_modified timestamptz,
      PRIMARY KEY (user_id, object_key)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS savecloud_save_file_index_user_game_key_idx
    ON savecloud_save_file_index (user_id, game_id, object_key)
  `;
}

/** Convierte un registro de entrada en una fila lista para PostgreSQL. */
function toWriteRow(input: {
  userId: string;
  gameId: string;
  objectKey: string;
  size?: number;
  lastModified?: Date;
}): SaveFileIndexWriteRow {
  const size = input.size;
  const safeSize = typeof size === "number" && Number.isSafeInteger(size) && size >= 0 ? size : null;

  return {
    user_id: input.userId.trim(),
    object_key: input.objectKey,
    game_id: input.gameId,
    size: safeSize,
    last_modified: input.lastModified && !Number.isNaN(input.lastModified.getTime()) ? input.lastModified : null,
  };
}

/** Convierte una fila PostgreSQL al contrato compartido de archivos guardados. */
function mapRowToGameSave(row: SaveFileIndexRow): GameSave {
  const prefix = `${row.user_id}/${row.game_id}/`;
  const lastModified = toDate(row.last_modified);
  const size = toSafeSize(row.size);

  return {
    gameId: row.game_id,
    key: row.object_key,
    filename: row.object_key.startsWith(prefix) ? row.object_key.slice(prefix.length) : row.object_key,
    lastModified,
    size,
  };
}

/** Convierte la marca temporal almacenada a Date y usa época cero para valores ausentes o inválidos. */
function toDate(value: Date | string | null): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

/** Convierte un bigint SQL a number solo si cabe dentro del rango entero seguro de JavaScript. */
function toSafeSize(value: number | string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}
