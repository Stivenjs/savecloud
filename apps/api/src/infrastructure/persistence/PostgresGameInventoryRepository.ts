import type { SQL } from "bun";
import type {
  DeviceInventoryRecord,
  GameInventoryEntry,
  GameProviderDevice,
  InventoryFileEntry,
} from "@domain/entities/GameInventory";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type {
  GameInventoryRepository,
  PublishDeviceInventoryInput,
  TransferSessionRecord,
} from "@domain/ports/GameInventoryRepository";
import type { S3GameInventoryRepository } from "./S3GameInventoryRepository";

interface DeviceInventoryRow {
  user_id: string;
  device_id: string;
  device_name: string;
  manifest_version: number;
  content_hash: string;
  updated_at: string;
  sharing_enabled: boolean;
  last_seen_at: string | null;
  app_version: string | null;
  tls_fingerprint: string | null;
  games: GameInventoryEntry[] | string;
}

interface GameProviderRow {
  user_id: string;
  device_id: string;
  device_name: string;
  total_bytes: number | string;
  payload_kind: string;
  manifest_hash: string;
  verified_at: string;
  last_seen_at: string | null;
  tls_fingerprint: string | null;
  files: InventoryFileEntry[] | string | null;
}

/** Adaptador PostgreSQL para inventarios de dispositivos y sesiones de transferencia. */
export class PostgresGameInventoryRepository implements GameInventoryRepository {
  constructor(
    private readonly sql: SQL,
    private readonly cloudInviteRepository: CloudInviteRepository,
    private readonly s3Fallback?: S3GameInventoryRepository
  ) {}

  /** Obtiene el inventario de un dispositivo y consulta S3 para registros heredados. */
  async getDeviceRecord(userId: string, deviceId: string): Promise<DeviceInventoryRecord | null> {
    const rows = await this.sql<DeviceInventoryRow[]>`
      SELECT user_id, device_id, device_name, manifest_version, content_hash, updated_at, sharing_enabled,
        last_seen_at, app_version, tls_fingerprint, games
      FROM savecloud_device_inventories WHERE user_id = ${userId.trim()} AND device_id = ${deviceId.trim()} LIMIT 1
    `;
    if (rows[0]) return mapDevice(rows[0]);
    return this.s3Fallback ? this.s3Fallback.getDeviceRecord(userId, deviceId) : null;
  }

  /** Guarda el inventario verificado y sus metadatos de publicación. */
  async putDeviceInventory(input: PublishDeviceInventoryInput): Promise<void> {
    const games = input.games.filter((game) => game.status === "verified");
    await this.sql`
      INSERT INTO savecloud_device_inventories
        (user_id, device_id, device_name, manifest_version, content_hash, updated_at, sharing_enabled, last_seen_at, app_version, tls_fingerprint, games)
      VALUES
        (${input.userId.trim()}, ${input.deviceId.trim()}, ${input.deviceName}, ${input.manifestVersion}, ${input.contentHash}, ${input.updatedAt}, ${input.sharingEnabled}, ${new Date().toISOString()}, NULL, ${input.tlsFingerprint ?? null}, ${JSON.stringify(games)}::jsonb)
      ON CONFLICT (user_id, device_id) DO UPDATE SET
        device_name = EXCLUDED.device_name,
        manifest_version = EXCLUDED.manifest_version,
        content_hash = EXCLUDED.content_hash,
        updated_at = EXCLUDED.updated_at,
        sharing_enabled = EXCLUDED.sharing_enabled,
        last_seen_at = EXCLUDED.last_seen_at,
        app_version = NULL,
        tls_fingerprint = EXCLUDED.tls_fingerprint,
        games = EXCLUDED.games
    `;
  }

  /** Elimina el inventario de un dispositivo; los proveedores se derivan de estas filas. */
  async deleteDeviceInventory(userId: string, deviceId: string): Promise<void> {
    await this.sql`
      DELETE FROM savecloud_device_inventories WHERE user_id = ${userId.trim()} AND device_id = ${deviceId.trim()}
    `;
    if (this.s3Fallback) await this.s3Fallback.deleteDeviceInventory(userId, deviceId);
  }

  /** Actualiza la última conexión y, si se indicó, la versión del cliente. */
  async recordHeartbeat(userId: string, deviceId: string, appVersion?: string): Promise<void> {
    const cleanVersion = appVersion?.trim() || null;
    await this.sql`
      UPDATE savecloud_device_inventories SET
        last_seen_at = ${new Date().toISOString()},
        app_version = CASE WHEN ${cleanVersion !== null} THEN ${cleanVersion} ELSE app_version END
      WHERE user_id = ${userId.trim()} AND device_id = ${deviceId.trim()}
    `;
  }

  /** Lista los dispositivos propios o de miembros activos que ofrecen un juego. */
  async listProvidersForGame(
    hostUserId: string,
    gameKey: string,
    excludeUserId?: string
  ): Promise<GameProviderDevice[]> {
    const hostId = hostUserId.trim();
    const normalizedGameKey = gameKey.trim();
    const rows = await this.sql<GameProviderRow[]>`
      SELECT inventory.user_id, inventory.device_id, inventory.device_name,
        (game.value->>'totalBytes')::bigint AS total_bytes,
        game.value->>'payloadKind' AS payload_kind,
        game.value->>'manifestHash' AS manifest_hash,
        game.value->>'verifiedAt' AS verified_at,
        inventory.last_seen_at,
        inventory.tls_fingerprint,
        game.value->'files' AS files
      FROM savecloud_device_inventories AS inventory
      CROSS JOIN LATERAL jsonb_array_elements(inventory.games) AS game(value)
      WHERE inventory.sharing_enabled = true
        AND game.value->>'status' = 'verified'
        AND game.value->>'gameKey' = ${normalizedGameKey}
        AND (
          inventory.user_id = ${hostId}
          OR EXISTS (
            SELECT 1 FROM savecloud_cloud_memberships AS memberships
            WHERE memberships.host_user_id = ${hostId}
              AND memberships.member_user_id = inventory.user_id
              AND memberships.active = true
          )
        )
        AND (${excludeUserId ?? null}::text IS NULL OR inventory.user_id <> ${excludeUserId ?? null})
      ORDER BY inventory.user_id, inventory.device_id
    `;
    if (rows.length > 0) return rows.map(mapProvider);
    return this.s3Fallback ? this.s3Fallback.listProvidersForGame(hostId, normalizedGameKey, excludeUserId) : [];
  }

  /** Crea o reemplaza una sesión temporal de transferencia. */
  async putTransferSession(record: TransferSessionRecord): Promise<void> {
    const expiresAtEpoch = Math.floor(new Date(record.expiresAt).getTime() / 1000);
    await this.sql`
      INSERT INTO savecloud_transfer_sessions
        (session_id, token, requester_user_id, target_user_id, target_device_id, game_key, manifest_hash, expires_at, expires_at_epoch)
      VALUES
        (${record.sessionId.trim()}, ${record.token}, ${record.requesterUserId}, ${record.targetUserId}, ${record.targetDeviceId.trim()}, ${record.gameKey}, ${record.manifestHash}, ${record.expiresAt}, ${expiresAtEpoch})
      ON CONFLICT (session_id) DO UPDATE SET
        token = EXCLUDED.token,
        requester_user_id = EXCLUDED.requester_user_id,
        target_user_id = EXCLUDED.target_user_id,
        target_device_id = EXCLUDED.target_device_id,
        game_key = EXCLUDED.game_key,
        manifest_hash = EXCLUDED.manifest_hash,
        expires_at = EXCLUDED.expires_at,
        expires_at_epoch = EXCLUDED.expires_at_epoch
    `;
  }

  /** Lista las sesiones vigentes dirigidas a un usuario y dispositivo. */
  async listPendingTransferSessions(targetUserId: string, targetDeviceId: string): Promise<TransferSessionRecord[]> {
    const rows = await this.sql<Array<TransferSessionRecord & { expiresAtEpoch: number | string }>>`
      SELECT session_id AS "sessionId", token, requester_user_id AS "requesterUserId",
        target_user_id AS "targetUserId", target_device_id AS "targetDeviceId", game_key AS "gameKey",
        manifest_hash AS "manifestHash", expires_at AS "expiresAt", expires_at_epoch AS "expiresAtEpoch"
      FROM savecloud_transfer_sessions
      WHERE target_device_id = ${targetDeviceId.trim()}
        AND target_user_id = ${targetUserId.trim()}
        AND expires_at_epoch >= ${Math.floor(Date.now() / 1000)}
      ORDER BY expires_at
    `;
    if (rows.length > 0) {
      const nowEpoch = Math.floor(Date.now() / 1000);
      return rows
        .filter((row) => row.targetUserId === targetUserId && Number(row.expiresAtEpoch) >= nowEpoch)
        .map(({ expiresAtEpoch: _expiresAtEpoch, ...record }) => record);
    }
    if (!this.s3Fallback) return [];
    return this.s3Fallback.listPendingTransferSessions(targetUserId, targetDeviceId);
  }

  /** Consume una sesión solo si el solicitante coincide con su propietario. */
  async consumeTransferSession(
    sessionId: string,
    requesterUserId: string
  ): Promise<"consumed" | "not_found" | "forbidden"> {
    const deleted = await this.sql<Array<{ session_id: string }>>`
      DELETE FROM savecloud_transfer_sessions
      WHERE session_id = ${sessionId.trim()} AND requester_user_id = ${requesterUserId}
      RETURNING session_id
    `;
    if (deleted.length > 0) {
      if (this.s3Fallback) await this.s3Fallback.consumeTransferSession(sessionId, requesterUserId);
      return "consumed";
    }

    const existing = await this.sql<Array<{ requester_user_id: string }>>`
      SELECT requester_user_id FROM savecloud_transfer_sessions WHERE session_id = ${sessionId.trim()} LIMIT 1
    `;
    if (existing[0]) return "forbidden";
    return this.s3Fallback ? this.s3Fallback.consumeTransferSession(sessionId, requesterUserId) : "not_found";
  }
}

/** Crea las tablas e índices de inventarios y sesiones de transferencia. */
export async function ensurePostgresGameInventorySchema(sql: SQL): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS savecloud_device_inventories (
      user_id text NOT NULL,
      device_id text NOT NULL,
      device_name text NOT NULL,
      manifest_version integer NOT NULL,
      content_hash text NOT NULL,
      updated_at text NOT NULL,
      sharing_enabled boolean NOT NULL,
      last_seen_at text,
      app_version text,
      tls_fingerprint text,
      games jsonb NOT NULL,
      PRIMARY KEY (user_id, device_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS savecloud_device_inventories_user_idx ON savecloud_device_inventories (user_id, device_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS savecloud_transfer_sessions (
      session_id text PRIMARY KEY,
      token text NOT NULL,
      requester_user_id text NOT NULL,
      target_user_id text NOT NULL,
      target_device_id text NOT NULL,
      game_key text NOT NULL,
      manifest_hash text NOT NULL,
      expires_at text NOT NULL,
      expires_at_epoch bigint NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS savecloud_transfer_sessions_target_idx ON savecloud_transfer_sessions (target_user_id, target_device_id, expires_at)`;
  await sql`CREATE INDEX IF NOT EXISTS savecloud_transfer_sessions_expiration_idx ON savecloud_transfer_sessions (expires_at_epoch)`;
}

/** Convierte una fila PostgreSQL en un registro de inventario. */
function mapDevice(row: DeviceInventoryRow): DeviceInventoryRecord {
  const games = typeof row.games === "string" ? (JSON.parse(row.games) as GameInventoryEntry[]) : row.games;
  return {
    deviceId: row.device_id,
    userId: row.user_id,
    deviceName: row.device_name,
    manifestVersion: row.manifest_version,
    contentHash: row.content_hash,
    updatedAt: row.updated_at,
    sharingEnabled: row.sharing_enabled,
    lastSeenAt: row.last_seen_at ?? undefined,
    appVersion: row.app_version ?? undefined,
    tlsFingerprint: row.tls_fingerprint ?? undefined,
    games,
  };
}

/** Convierte una fila de consulta en un dispositivo proveedor. */
function mapProvider(row: GameProviderRow): GameProviderDevice {
  const files =
    typeof row.files === "string" ? (JSON.parse(row.files) as InventoryFileEntry[]) : (row.files ?? undefined);
  return {
    userId: row.user_id,
    deviceId: row.device_id,
    deviceName: row.device_name,
    totalBytes: Number(row.total_bytes),
    payloadKind: row.payload_kind,
    manifestHash: row.manifest_hash,
    verifiedAt: row.verified_at,
    lastSeenAt: row.last_seen_at ?? undefined,
    tlsFingerprint: row.tls_fingerprint ?? undefined,
    files,
  };
}
