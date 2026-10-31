import type { SQL } from "bun";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";

interface ConnectionPresenceRow {
  connection_id: string;
  last_activity_at: number | string | null;
  activity_game_id: string | null;
  activity_game_name: string | null;
}

/** Adaptador PostgreSQL de las conexiones WebSocket y sus datos de presencia. */
export class PostgresConnectionRepository implements ConnectionRepository {
  constructor(private readonly sql: SQL) {}

  /** Guarda una conexión activa y reinicia sus metadatos de presencia. */
  async saveConnection(connectionId: string, userId: string, ttl: number, deviceId?: string): Promise<void> {
    await this.sql`
      INSERT INTO savecloud_connections (connection_id, user_id, expires_at_epoch, device_id, last_activity_at)
      VALUES (${connectionId}, ${userId}, ${ttl}, ${deviceId ?? null}, ${Date.now()})
      ON CONFLICT (connection_id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        expires_at_epoch = EXCLUDED.expires_at_epoch,
        device_id = EXCLUDED.device_id,
        last_activity_at = EXCLUDED.last_activity_at,
        activity_game_id = NULL,
        activity_game_name = NULL
    `;
  }

  /** Elimina una conexión desconectada. */
  async deleteConnection(connectionId: string): Promise<void> {
    await this.sql`DELETE FROM savecloud_connections WHERE connection_id = ${connectionId}`;
  }

  /** Lista las conexiones asociadas a un usuario. */
  async getConnectionsByUser(userId: string): Promise<string[]> {
    const rows = await this.sql<Array<{ connection_id: string }>>`
      SELECT connection_id FROM savecloud_connections WHERE user_id = ${userId}
    `;
    return rows.map((row) => row.connection_id);
  }

  /** Lista las conexiones de un usuario y dispositivo. */
  async getConnectionsByUserAndDevice(userId: string, deviceId: string): Promise<string[]> {
    const rows = await this.sql<Array<{ connection_id: string }>>`
      SELECT connection_id FROM savecloud_connections WHERE user_id = ${userId} AND device_id = ${deviceId}
    `;
    return rows.map((row) => row.connection_id);
  }

  /** Lista los metadatos de presencia de las conexiones de un usuario. */
  async getConnectionPresenceByUser(userId: string): Promise<
    Array<{
      connectionId: string;
      lastActivityAt: number | null;
      activityGameId: string | null;
      activityGameName: string | null;
    }>
  > {
    const rows = await this.sql<ConnectionPresenceRow[]>`
      SELECT connection_id, last_activity_at, activity_game_id, activity_game_name
      FROM savecloud_connections WHERE user_id = ${userId}
    `;
    return rows.map((row) => ({
      connectionId: row.connection_id,
      lastActivityAt: row.last_activity_at === null ? null : Number(row.last_activity_at),
      activityGameId: row.activity_game_id,
      activityGameName: row.activity_game_name,
    }));
  }

  /** Busca el usuario propietario de una conexión. */
  async getUserByConnection(connectionId: string): Promise<string | null> {
    const rows = await this.sql<Array<{ user_id: string }>>`
      SELECT user_id FROM savecloud_connections WHERE connection_id = ${connectionId} LIMIT 1
    `;
    return rows[0]?.user_id ?? null;
  }

  /** Actualiza la actividad reciente de una conexión. */
  async setConnectionActivity(
    connectionId: string,
    input: { lastActivityAt: number; activityGameId?: string | null; activityGameName?: string | null }
  ): Promise<void> {
    await this.sql`
      UPDATE savecloud_connections SET
        last_activity_at = ${input.lastActivityAt},
        activity_game_id = ${input.activityGameId ?? null},
        activity_game_name = ${input.activityGameName ?? null}
      WHERE connection_id = ${connectionId}
    `;
  }
}

/** Crea la tabla y los índices para consultar conexiones por usuario y expiración. */
export async function ensurePostgresConnectionSchema(sql: SQL): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS savecloud_connections (
      connection_id text PRIMARY KEY,
      user_id text NOT NULL,
      expires_at_epoch bigint NOT NULL,
      device_id text,
      last_activity_at bigint NOT NULL,
      activity_game_id text,
      activity_game_name text
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS savecloud_connections_user_idx ON savecloud_connections (user_id, connection_id)`;
  await sql`CREATE INDEX IF NOT EXISTS savecloud_connections_expiration_idx ON savecloud_connections (expires_at_epoch)`;
}
