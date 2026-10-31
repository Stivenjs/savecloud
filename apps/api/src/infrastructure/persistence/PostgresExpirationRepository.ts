import type { SQL } from "bun";

const DEFAULT_BATCH_SIZE = 500;

export interface ExpiredPostgresRecords {
  invites: number;
  accessSessions: number;
  shareTokens: number;
  connections: number;
  transferSessions: number;
}

/** Elimina por lotes los registros cuya expiración antes dependía del TTL de DynamoDB. */
export async function purgeExpiredPostgresRecords(
  sql: SQL,
  nowEpoch: number,
  batchSize = DEFAULT_BATCH_SIZE
): Promise<ExpiredPostgresRecords> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error("El tamaño del lote de expiración debe ser un entero positivo.");
  }

  const deleted: ExpiredPostgresRecords = {
    invites: 0,
    accessSessions: 0,
    shareTokens: 0,
    connections: 0,
    transferSessions: 0,
  };

  deleted.invites = await deleteExpiredInvites(sql, nowEpoch, batchSize);
  deleted.accessSessions = await deleteExpiredAccessSessions(sql, nowEpoch, batchSize);
  deleted.shareTokens = await deleteExpiredShareTokens(sql, nowEpoch, batchSize);
  deleted.connections = await deleteExpiredConnections(sql, nowEpoch, batchSize);
  deleted.transferSessions = await deleteExpiredTransferSessions(sql, nowEpoch, batchSize);
  return deleted;
}

/** Elimina invitaciones vencidas en lotes bloqueados con SKIP LOCKED. */
async function deleteExpiredInvites(sql: SQL, nowEpoch: number, batchSize: number): Promise<number> {
  let deleted = 0;
  let rows: Array<{ id: string }>;
  do {
    rows = await sql<Array<{ id: string }>>`
      WITH expired AS (
        SELECT id FROM savecloud_cloud_invites WHERE expires_at_epoch <= ${nowEpoch}
        ORDER BY expires_at_epoch LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
      )
      DELETE FROM savecloud_cloud_invites AS invites USING expired
      WHERE invites.id = expired.id RETURNING invites.id
    `;
    deleted += rows.length;
  } while (rows.length === batchSize);
  return deleted;
}

/** Elimina sesiones de acceso vencidas en lotes. */
async function deleteExpiredAccessSessions(sql: SQL, nowEpoch: number, batchSize: number): Promise<number> {
  let deleted = 0;
  let rows: Array<{ id: string }>;
  do {
    rows = await sql<Array<{ id: string }>>`
      WITH expired AS (
        SELECT session_id FROM savecloud_access_sessions WHERE expires_at_epoch <= ${nowEpoch}
        ORDER BY expires_at_epoch LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
      )
      DELETE FROM savecloud_access_sessions AS sessions USING expired
      WHERE sessions.session_id = expired.session_id RETURNING sessions.session_id AS id
    `;
    deleted += rows.length;
  } while (rows.length === batchSize);
  return deleted;
}

/** Elimina tokens compartidos vencidos en lotes. */
async function deleteExpiredShareTokens(sql: SQL, nowEpoch: number, batchSize: number): Promise<number> {
  let deleted = 0;
  let rows: Array<{ token: string }>;
  do {
    rows = await sql<Array<{ token: string }>>`
      WITH expired AS (
        SELECT token FROM savecloud_share_tokens WHERE expires_at_epoch <= ${nowEpoch}
        ORDER BY expires_at_epoch LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
      )
      DELETE FROM savecloud_share_tokens AS tokens USING expired
      WHERE tokens.token = expired.token RETURNING tokens.token
    `;
    deleted += rows.length;
  } while (rows.length === batchSize);
  return deleted;
}

/** Elimina conexiones expiradas en lotes. */
async function deleteExpiredConnections(sql: SQL, nowEpoch: number, batchSize: number): Promise<number> {
  let deleted = 0;
  let rows: Array<{ connection_id: string }>;
  do {
    rows = await sql<Array<{ connection_id: string }>>`
      WITH expired AS (
        SELECT connection_id FROM savecloud_connections WHERE expires_at_epoch <= ${nowEpoch}
        ORDER BY expires_at_epoch LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
      )
      DELETE FROM savecloud_connections AS connections USING expired
      WHERE connections.connection_id = expired.connection_id RETURNING connections.connection_id
    `;
    deleted += rows.length;
  } while (rows.length === batchSize);
  return deleted;
}

/** Elimina sesiones de transferencia expiradas en lotes. */
async function deleteExpiredTransferSessions(sql: SQL, nowEpoch: number, batchSize: number): Promise<number> {
  let deleted = 0;
  let rows: Array<{ session_id: string }>;
  do {
    rows = await sql<Array<{ session_id: string }>>`
      WITH expired AS (
        SELECT session_id FROM savecloud_transfer_sessions WHERE expires_at_epoch <= ${nowEpoch}
        ORDER BY expires_at_epoch LIMIT ${batchSize} FOR UPDATE SKIP LOCKED
      )
      DELETE FROM savecloud_transfer_sessions AS sessions USING expired
      WHERE sessions.session_id = expired.session_id RETURNING sessions.session_id
    `;
    deleted += rows.length;
  } while (rows.length === batchSize);
  return deleted;
}
