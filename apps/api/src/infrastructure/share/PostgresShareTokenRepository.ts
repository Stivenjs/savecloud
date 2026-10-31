import type { SQL } from "bun";
import { randomBytes } from "node:crypto";
import type { GetTokenResult, ShareTokenPayload } from "@domain/entities/ShareToken";
import type { ShareTokenRepository } from "@domain/ports/ShareTokenRepository";
import type { ShareTokenS3 } from "./ShareTokenS3";

interface ShareTokenRow {
  user_id: string;
  game_id: string;
  expires_at: string;
  expires_at_epoch: number | string;
}

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const TOKEN_BYTES = 24;

/** Adaptador PostgreSQL para tokens compartidos con lectura heredada desde S3. */
export class PostgresShareTokenRepository implements ShareTokenRepository {
  constructor(
    private readonly sql: SQL,
    private readonly s3Fallback?: ShareTokenS3
  ) {}

  /** Crea un token aleatorio con vencimiento. */
  async createToken(
    userId: string,
    gameId: string,
    ttlSeconds = DEFAULT_TTL_SECONDS
  ): Promise<{ token: string; expiresAt: string }> {
    const cleanUserId = userId?.trim();
    const cleanGameId = gameId?.trim();
    if (!cleanUserId) throw new Error("userId must not be empty");
    if (!cleanGameId) throw new Error("gameId must not be empty");
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1) {
      throw new Error(`ttlSeconds must be a positive finite number, got: ${ttlSeconds}`);
    }

    const token = randomBytes(TOKEN_BYTES).toString("hex");
    const expiration = new Date(Date.now() + ttlSeconds * 1000);
    const expiresAt = expiration.toISOString();
    await this.sql`
      INSERT INTO savecloud_share_tokens (token, user_id, game_id, expires_at, expires_at_epoch)
      VALUES (${token}, ${cleanUserId}, ${cleanGameId}, ${expiresAt}, ${Math.floor(expiration.getTime() / 1000)})
    `;
    return { token, expiresAt };
  }

  /** Busca un token y diferencia los estados ausente, vencido y válido. */
  async getToken(token: string): Promise<GetTokenResult> {
    const cleanToken = token?.trim();
    if (!cleanToken) return { status: "not_found" };

    try {
      const rows = await this.sql<ShareTokenRow[]>`
        SELECT user_id, game_id, expires_at, expires_at_epoch
        FROM savecloud_share_tokens WHERE token = ${cleanToken} LIMIT 1
      `;
      const row = rows[0];
      if (row) {
        if (Number(row.expires_at_epoch) <= Math.floor(Date.now() / 1000)) {
          return { status: "expired" };
        }
        return { status: "ok", payload: toPayload(row) };
      }
      return this.s3Fallback ? this.s3Fallback.getToken(cleanToken) : { status: "not_found" };
    } catch (cause: unknown) {
      console.error("[PostgresShareTokenRepository] Error al obtener token", { cause });
      return { status: "error", cause };
    }
  }
}

/** Crea la tabla e índice de vencimiento de tokens compartidos. */
export async function ensurePostgresShareTokenSchema(sql: SQL): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS savecloud_share_tokens (
      token text PRIMARY KEY,
      user_id text NOT NULL,
      game_id text NOT NULL,
      expires_at text NOT NULL,
      expires_at_epoch bigint NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS savecloud_share_tokens_expiration_idx ON savecloud_share_tokens (expires_at_epoch)`;
}

/** Convierte una fila SQL al contenido público de un token. */
function toPayload(row: ShareTokenRow): ShareTokenPayload {
  return { userId: row.user_id, gameId: row.game_id, expiresAt: row.expires_at };
}
