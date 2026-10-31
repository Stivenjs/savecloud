import type { SQL } from "bun";
import type { GameStat } from "@domain/entities/GameStat";
import type { GameStatRepository } from "@domain/ports/GameStatRepository";

interface GameStatRow {
  user_id: string;
  game_id: string;
  file_count: number | string;
  total_size_bytes: number | string;
  last_modified: Date | string | null;
}

interface GameStatDeltaRow {
  file_count: number | string;
  total_size_bytes: number | string;
}

/** Implementación PostgreSQL del repositorio de estadísticas de juegos. */
export class PostgresGameStatRepository implements GameStatRepository {
  constructor(private readonly sql: SQL) {}

  /** Lista las estadísticas asociadas a un usuario o ámbito compartido. */
  async listByUser(userId: string): Promise<GameStat[]> {
    const rows = await this.sql<GameStatRow[]>`
      SELECT user_id, game_id, file_count, total_size_bytes, last_modified
      FROM savecloud_game_stats WHERE user_id = ${userId} ORDER BY game_id
    `;
    return rows.map((row) => ({
      userId: row.user_id,
      gameId: row.game_id,
      fileCount: Number(row.file_count),
      totalSizeBytes: Number(row.total_size_bytes),
      lastModified: toDate(row.last_modified),
    }));
  }

  /** Inserta o reemplaza la estadística consolidada de un juego. */
  async save(stat: GameStat): Promise<void> {
    await this.sql`
      INSERT INTO savecloud_game_stats (user_id, game_id, file_count, total_size_bytes, last_modified)
      VALUES (${stat.userId}, ${stat.gameId}, ${stat.fileCount}, ${stat.totalSizeBytes}, ${stat.lastModified?.toISOString() ?? null})
      ON CONFLICT (user_id, game_id) DO UPDATE SET
        file_count = EXCLUDED.file_count,
        total_size_bytes = EXCLUDED.total_size_bytes,
        last_modified = EXCLUDED.last_modified
    `;
  }

  /** Elimina las estadísticas de un juego para un usuario. */
  async delete(userId: string, gameId: string): Promise<void> {
    await this.sql`DELETE FROM savecloud_game_stats WHERE user_id = ${userId} AND game_id = ${gameId}`;
  }

  /** Aplica los deltas de archivos y bytes de forma atómica en una sentencia SQL. */
  async applyDelta(input: {
    userId: string;
    gameId: string;
    deltaFileCount: number;
    deltaSizeBytes: number;
    lastModified?: Date | null;
  }): Promise<void> {
    const { userId, gameId, deltaFileCount, deltaSizeBytes, lastModified } = input;
    if (deltaFileCount === 0 && deltaSizeBytes === 0 && lastModified === undefined) return;

    const hasLastModified = lastModified !== undefined;
    const lastModifiedValue = lastModified?.toISOString() ?? null;
    const rows = await this.sql<GameStatDeltaRow[]>`
      INSERT INTO savecloud_game_stats (user_id, game_id, file_count, total_size_bytes, last_modified)
      VALUES (${userId}, ${gameId}, ${deltaFileCount}, ${deltaSizeBytes}, ${lastModifiedValue})
      ON CONFLICT (user_id, game_id) DO UPDATE SET
        file_count = savecloud_game_stats.file_count + EXCLUDED.file_count,
        total_size_bytes = savecloud_game_stats.total_size_bytes + EXCLUDED.total_size_bytes,
        last_modified = CASE WHEN ${hasLastModified} THEN EXCLUDED.last_modified ELSE savecloud_game_stats.last_modified END
      RETURNING file_count, total_size_bytes
    `;

    const updated = rows[0];
    if (updated && (Number(updated.file_count) <= 0 || Number(updated.total_size_bytes) < 0)) {
      await this.sql`
        DELETE FROM savecloud_game_stats
        WHERE user_id = ${userId} AND game_id = ${gameId}
          AND file_count <= 0 AND total_size_bytes <= 0
      `;
    }
  }
}

/** Crea la tabla e índices de consulta de estadísticas. */
export async function ensurePostgresGameStatSchema(sql: SQL): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS savecloud_game_stats (
      user_id text NOT NULL,
      game_id text NOT NULL,
      file_count bigint NOT NULL,
      total_size_bytes bigint NOT NULL,
      last_modified timestamptz,
      PRIMARY KEY (user_id, game_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS savecloud_game_stats_user_game_idx ON savecloud_game_stats (user_id, game_id)`;
}

/** Convierte una fecha SQL a Date y mantiene null para datos ausentes o inválidos. */
function toDate(value: Date | string | null): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
