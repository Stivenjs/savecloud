import type { SQL } from "bun";
import type { AccessSession } from "@domain/entities/AccessSession";
import type { CloudInvite, CloudMembership } from "@domain/entities/CloudInvite";
import type { AccessSessionRepository } from "@domain/ports/AccessSessionRepository";
import type { CloudInviteRepository, CreateInviteInput } from "@domain/ports/CloudInviteRepository";
import type { S3CloudInviteRepository } from "./S3CloudInviteRepository";
import crypto from "node:crypto";

interface InviteRow {
  id: string;
  host_user_id: string;
  invitee_user_id: string | null;
  token: string | null;
  ws_url: string | null;
  status: CloudInvite["status"];
  created_at: string;
  updated_at: string;
  expires_at: string;
  accepted_at: string | null;
  rejected_at: string | null;
  revoked_at: string | null;
}

interface MembershipRow {
  host_user_id: string;
  member_user_id: string;
  invited_by_id: string;
  ws_url: string | null;
  created_at: string;
  updated_at: string;
  active: boolean;
  scheduled_deletion_at: string | null;
  scheduled_deletion_by: string | null;
}

interface AccessSessionRow {
  sessionId: string;
  user_id: string;
  host_user_id: string;
  refresh_token_hash: string;
  active: boolean;
  created_at: string;
  expires_at_epoch: number | string;
}

/** Adaptador PostgreSQL para invitaciones, membresías, permisos de juegos y sesiones de acceso. */
export class PostgresCloudInviteRepository implements CloudInviteRepository, AccessSessionRepository {
  /**
   * Prepara el adaptador con el pool compartido y el respaldo histórico de S3.
   *
   * @param sql - Pool de conexiones PostgreSQL de la aplicación.
   * @param s3Fallback - Repositorio S3 usado para leer registros heredados.
   */
  constructor(
    private readonly sql: SQL,
    private readonly s3Fallback?: S3CloudInviteRepository
  ) {}

  /** Crea una invitación pendiente con su fecha de vencimiento y un token opcional. */
  async createInvite(input: CreateInviteInput): Promise<CloudInvite> {
    const now = new Date();
    const expiration = new Date(now.getTime() + Math.max(60, input.ttlSeconds) * 1000);
    const invite: CloudInvite = {
      id: crypto.randomUUID(),
      hostUserId: input.hostUserId.trim(),
      inviteeUserId: input.inviteeUserId?.trim() || null,
      token: input.withToken ? crypto.randomBytes(24).toString("hex") : null,
      wsUrl: input.wsUrl ?? null,
      status: "pending",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiration.toISOString(),
      acceptedAt: null,
      rejectedAt: null,
      revokedAt: null,
    };

    await this.sql`
      INSERT INTO savecloud_cloud_invites
        (id, host_user_id, invitee_user_id, token, ws_url, status, created_at, updated_at, expires_at, expires_at_epoch)
      VALUES
        (${invite.id}, ${invite.hostUserId}, ${invite.inviteeUserId}, ${invite.token}, ${invite.wsUrl}, ${invite.status}, ${invite.createdAt}, ${invite.updatedAt}, ${invite.expiresAt}, ${Math.floor(expiration.getTime() / 1000)})
    `;
    return invite;
  }

  /** Busca una invitación vigente por su identificador. */
  async getInviteById(id: string): Promise<CloudInvite | null> {
    const rows = await this.sql<InviteRow[]>`
      SELECT id, host_user_id, invitee_user_id, token, ws_url, status, created_at, updated_at, expires_at, accepted_at, rejected_at, revoked_at
      FROM savecloud_cloud_invites WHERE id = ${id} AND expires_at > ${new Date().toISOString()} LIMIT 1
    `;
    return rows[0] ? mapInvite(rows[0]) : (this.s3Fallback?.getInviteById(id) ?? null);
  }

  /** Busca una invitación vigente por su token público. */
  async getInviteByToken(token: string): Promise<CloudInvite | null> {
    const rows = await this.sql<InviteRow[]>`
      SELECT id, host_user_id, invitee_user_id, token, ws_url, status, created_at, updated_at, expires_at, accepted_at, rejected_at, revoked_at
      FROM savecloud_cloud_invites WHERE token = ${token.trim()} AND expires_at > ${new Date().toISOString()} LIMIT 1
    `;
    return rows[0] ? mapInvite(rows[0]) : (this.s3Fallback?.getInviteByToken(token) ?? null);
  }

  /** Lista las invitaciones pendientes y vigentes dirigidas a un usuario. */
  async listPendingInvitesForUser(userId: string): Promise<CloudInvite[]> {
    const rows = await this.sql<InviteRow[]>`
      SELECT id, host_user_id, invitee_user_id, token, ws_url, status, created_at, updated_at, expires_at, accepted_at, rejected_at, revoked_at
      FROM savecloud_cloud_invites
      WHERE invitee_user_id = ${userId.trim()} AND status = 'pending' AND expires_at > ${new Date().toISOString()}
      ORDER BY created_at DESC
    `;
    return rows.length > 0 || !this.s3Fallback
      ? rows.map(mapInvite)
      : this.s3Fallback.listPendingInvitesForUser(userId);
  }

  /** Actualiza los campos modificables de una invitación. */
  async updateInvite(invite: CloudInvite): Promise<void> {
    await this.sql`
      UPDATE savecloud_cloud_invites SET
        host_user_id = ${invite.hostUserId}, invitee_user_id = ${invite.inviteeUserId}, token = ${invite.token},
        ws_url = ${invite.wsUrl ?? null}, status = ${invite.status}, updated_at = ${invite.updatedAt || new Date().toISOString()},
        expires_at = ${invite.expiresAt}, expires_at_epoch = ${Math.floor(new Date(invite.expiresAt).getTime() / 1000)},
        accepted_at = ${invite.acceptedAt ?? null}, rejected_at = ${invite.rejectedAt ?? null}, revoked_at = ${invite.revokedAt ?? null}
      WHERE id = ${invite.id}
    `;
  }

  /** Inserta o reemplaza una membresía de nube. */
  async upsertMembership(membership: CloudMembership): Promise<void> {
    await this.sql`
      INSERT INTO savecloud_cloud_memberships
        (host_user_id, member_user_id, invited_by_id, ws_url, created_at, updated_at, active, scheduled_deletion_at, scheduled_deletion_by)
      VALUES
        (${membership.hostUserId}, ${membership.memberUserId}, ${membership.invitedById}, ${membership.wsUrl ?? null}, ${membership.createdAt}, ${membership.updatedAt || new Date().toISOString()}, ${membership.active}, ${membership.scheduledDeletionAt ?? null}, ${membership.scheduledDeletionBy ?? null})
      ON CONFLICT (host_user_id, member_user_id) DO UPDATE SET
        invited_by_id = EXCLUDED.invited_by_id, ws_url = EXCLUDED.ws_url, created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at, active = EXCLUDED.active,
        scheduled_deletion_at = EXCLUDED.scheduled_deletion_at, scheduled_deletion_by = EXCLUDED.scheduled_deletion_by
    `;
  }

  /** Busca una membresía por el identificador del dueño y del miembro. */
  async getMembership(hostUserId: string, memberUserId: string): Promise<CloudMembership | null> {
    const rows = await this.sql<MembershipRow[]>`
      SELECT host_user_id, member_user_id, invited_by_id, ws_url, created_at, updated_at, active, scheduled_deletion_at, scheduled_deletion_by
      FROM savecloud_cloud_memberships WHERE host_user_id = ${hostUserId} AND member_user_id = ${memberUserId} LIMIT 1
    `;
    return rows[0] ? mapMembership(rows[0]) : (this.s3Fallback?.getMembership(hostUserId, memberUserId) ?? null);
  }

  /** Lista las membresías activas de un miembro. */
  async listMembershipsForMember(memberUserId: string): Promise<CloudMembership[]> {
    const rows = await this.sql<MembershipRow[]>`
      SELECT host_user_id, member_user_id, invited_by_id, ws_url, created_at, updated_at, active, scheduled_deletion_at, scheduled_deletion_by
      FROM savecloud_cloud_memberships WHERE member_user_id = ${memberUserId.trim()} AND active = true ORDER BY host_user_id
    `;
    if (rows.length > 0 || !this.s3Fallback) return rows.map(mapMembership);
    return this.s3Fallback.listMembershipsForMember(memberUserId);
  }

  /** Lista todas las membresías de un dueño. */
  async listMembershipsForHost(hostUserId: string): Promise<CloudMembership[]> {
    const rows = await this.sql<MembershipRow[]>`
      SELECT host_user_id, member_user_id, invited_by_id, ws_url, created_at, updated_at, active, scheduled_deletion_at, scheduled_deletion_by
      FROM savecloud_cloud_memberships WHERE host_user_id = ${hostUserId.trim()} ORDER BY member_user_id
    `;
    if (rows.length > 0 || !this.s3Fallback) return rows.map(mapMembership);
    return this.s3Fallback.listMembershipsForHost(hostUserId);
  }

  /** Agrega o elimina el permiso para compartir un juego. */
  async setGameShared(hostUserId: string, memberUserId: string, gameId: string, shared: boolean): Promise<void> {
    if (!shared) {
      await this
        .sql`DELETE FROM savecloud_game_shares WHERE host_user_id = ${hostUserId.trim()} AND member_user_id = ${memberUserId.trim()} AND game_id = ${gameId.trim()}`;
      return;
    }
    await this.sql`
      INSERT INTO savecloud_game_shares (host_user_id, member_user_id, game_id, created_at)
      VALUES (${hostUserId.trim()}, ${memberUserId.trim()}, ${gameId.trim()}, ${new Date().toISOString()})
      ON CONFLICT (host_user_id, member_user_id, game_id) DO NOTHING
    `;
  }

  /** Comprueba si un juego está compartido con un miembro. */
  async isGameSharedWithMember(hostUserId: string, memberUserId: string, gameId: string): Promise<boolean> {
    const rows = await this.sql<Array<{ present: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM savecloud_game_shares WHERE host_user_id = ${hostUserId.trim()} AND member_user_id = ${memberUserId.trim()} AND game_id = ${gameId.trim()}) AS present
    `;
    if (rows[0]?.present) return true;
    return this.s3Fallback?.isGameSharedWithMember(hostUserId, memberUserId, gameId) ?? false;
  }

  /** Lista los identificadores de juegos compartidos con un miembro. */
  async listSharedGamesForMember(hostUserId: string, memberUserId: string): Promise<string[]> {
    const rows = await this.sql<Array<{ game_id: string }>>`
      SELECT game_id FROM savecloud_game_shares WHERE host_user_id = ${hostUserId.trim()} AND member_user_id = ${memberUserId.trim()} ORDER BY game_id
    `;
    if (rows.length > 0 || !this.s3Fallback) return rows.map((row) => row.game_id);
    return this.s3Fallback.listSharedGamesForMember(hostUserId, memberUserId);
  }

  /** Desactiva una membresía sin programar su eliminación física. */
  async deactivateMembership(hostUserId: string, memberUserId: string): Promise<void> {
    await this
      .sql`UPDATE savecloud_cloud_memberships SET active = false, updated_at = ${new Date().toISOString()} WHERE host_user_id = ${hostUserId.trim()} AND member_user_id = ${memberUserId.trim()}`;
  }

  /** Desactiva una membresía y registra la fecha programada para purgarla. */
  async scheduleMemberDeletion(
    hostUserId: string,
    memberUserId: string,
    scheduledDeletionAt: string,
    deletedBy: string
  ): Promise<void> {
    await this.sql`
      UPDATE savecloud_cloud_memberships SET active = false, updated_at = ${new Date().toISOString()},
        scheduled_deletion_at = ${scheduledDeletionAt}, scheduled_deletion_by = ${deletedBy}
      WHERE host_user_id = ${hostUserId.trim()} AND member_user_id = ${memberUserId.trim()}
    `;
  }

  /** Reactiva una membresía y cancela su eliminación programada. */
  async cancelScheduledMemberDeletion(hostUserId: string, memberUserId: string): Promise<void> {
    await this.sql`
      UPDATE savecloud_cloud_memberships SET active = true, updated_at = ${new Date().toISOString()},
        scheduled_deletion_at = NULL, scheduled_deletion_by = NULL
      WHERE host_user_id = ${hostUserId.trim()} AND member_user_id = ${memberUserId.trim()}
    `;
  }

  /** Lista las membresías cuyo período de gracia ya terminó. */
  async listMembershipsReadyForPurge(now: string): Promise<CloudMembership[]> {
    const rows = await this.sql<MembershipRow[]>`
      SELECT host_user_id, member_user_id, invited_by_id, ws_url, created_at, updated_at, active, scheduled_deletion_at, scheduled_deletion_by
      FROM savecloud_cloud_memberships WHERE scheduled_deletion_at IS NOT NULL AND scheduled_deletion_at <= ${now}
      ORDER BY scheduled_deletion_at
    `;
    return rows.map(mapMembership);
  }

  /** Elimina una membresía después de purgar los datos asociados. */
  async deleteMembershipRecord(hostUserId: string, memberUserId: string): Promise<void> {
    await this
      .sql`DELETE FROM savecloud_cloud_memberships WHERE host_user_id = ${hostUserId.trim()} AND member_user_id = ${memberUserId.trim()}`;
  }

  /** Elimina todos los permisos de juegos compartidos entre el dueño y el miembro. */
  async deleteAllGameSharesForMember(hostUserId: string, memberUserId: string): Promise<void> {
    await this
      .sql`DELETE FROM savecloud_game_shares WHERE host_user_id = ${hostUserId.trim()} AND member_user_id = ${memberUserId.trim()}`;
  }

  /** Crea una sesión si su identificador todavía no existe. */
  async create(session: AccessSession): Promise<void> {
    await this.sql`
      INSERT INTO savecloud_access_sessions (session_id, user_id, host_user_id, refresh_token_hash, active, created_at, expires_at_epoch)
      VALUES (${session.sessionId}, ${session.userId}, ${session.hostUserId}, ${session.refreshTokenHash}, ${session.active}, ${session.createdAt}, ${session.expiresAtEpoch})
    `;
  }

  /** Busca una sesión de acceso por su identificador. */
  async get(sessionId: string): Promise<AccessSession | null> {
    const rows = await this.sql<AccessSessionRow[]>`
      SELECT session_id AS "sessionId", user_id, host_user_id, refresh_token_hash, active, created_at, expires_at_epoch
      FROM savecloud_access_sessions WHERE session_id = ${sessionId} LIMIT 1
    `;
    const row = rows[0];
    return row
      ? {
          sessionId: row.sessionId,
          userId: row.user_id,
          hostUserId: row.host_user_id,
          refreshTokenHash: row.refresh_token_hash,
          active: row.active,
          createdAt: row.created_at,
          expiresAtEpoch: Number(row.expires_at_epoch),
        }
      : null;
  }

  /** Rota el token de actualización si el actual coincide y la sesión no ha vencido. */
  async rotateRefreshToken(
    sessionId: string,
    expectedTokenHash: string,
    nextTokenHash: string,
    expiresAtEpoch: number
  ): Promise<boolean> {
    const rows = await this.sql<Array<{ session_id: string }>>`
      UPDATE savecloud_access_sessions SET refresh_token_hash = ${nextTokenHash}, expires_at_epoch = ${expiresAtEpoch}
      WHERE session_id = ${sessionId} AND active = true AND refresh_token_hash = ${expectedTokenHash} AND expires_at_epoch > ${Math.floor(Date.now() / 1000)}
      RETURNING session_id
    `;
    return rows.length > 0;
  }

  /** Marca una sesión como inactiva. */
  async revoke(sessionId: string): Promise<void> {
    await this.sql`UPDATE savecloud_access_sessions SET active = false WHERE session_id = ${sessionId}`;
  }

  /** Revoca todas las sesiones de una membresía. */
  async revokeMembershipSessions(hostUserId: string, userId: string): Promise<void> {
    await this
      .sql`UPDATE savecloud_access_sessions SET active = false WHERE host_user_id = ${hostUserId} AND user_id = ${userId} AND active = true`;
  }
}

/** Crea las tablas e índices PostgreSQL usados por la colaboración y las sesiones. */
export async function ensurePostgresCloudInviteSchema(sql: SQL): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS savecloud_cloud_invites (
      id text PRIMARY KEY, host_user_id text NOT NULL, invitee_user_id text, token text UNIQUE, ws_url text,
      status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'revoked', 'expired')),
      created_at text NOT NULL, updated_at text NOT NULL, expires_at text NOT NULL, expires_at_epoch bigint NOT NULL,
      accepted_at text, rejected_at text, revoked_at text
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS savecloud_cloud_invites_invitee_status_idx ON savecloud_cloud_invites (invitee_user_id, status, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS savecloud_cloud_invites_token_idx ON savecloud_cloud_invites (token) WHERE token IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS savecloud_cloud_invites_expiration_idx ON savecloud_cloud_invites (expires_at_epoch)`;
  await sql`
    CREATE TABLE IF NOT EXISTS savecloud_cloud_memberships (
      host_user_id text NOT NULL, member_user_id text NOT NULL, invited_by_id text NOT NULL, ws_url text,
      created_at text NOT NULL, updated_at text NOT NULL, active boolean NOT NULL,
      scheduled_deletion_at text, scheduled_deletion_by text,
      PRIMARY KEY (host_user_id, member_user_id)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS savecloud_cloud_memberships_member_active_idx ON savecloud_cloud_memberships (member_user_id, host_user_id) WHERE active = true`;
  await sql`CREATE INDEX IF NOT EXISTS savecloud_cloud_memberships_purge_idx ON savecloud_cloud_memberships (scheduled_deletion_at) WHERE scheduled_deletion_at IS NOT NULL`;
  await sql`
    CREATE TABLE IF NOT EXISTS savecloud_game_shares (
      host_user_id text NOT NULL, member_user_id text NOT NULL, game_id text NOT NULL, created_at text NOT NULL,
      PRIMARY KEY (host_user_id, member_user_id, game_id)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS savecloud_access_sessions (
      session_id text PRIMARY KEY, user_id text NOT NULL, host_user_id text NOT NULL, refresh_token_hash text NOT NULL,
      active boolean NOT NULL, created_at text NOT NULL, expires_at_epoch bigint NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS savecloud_access_sessions_membership_idx ON savecloud_access_sessions (host_user_id, user_id) WHERE active = true`;
  await sql`CREATE INDEX IF NOT EXISTS savecloud_access_sessions_expiration_idx ON savecloud_access_sessions (expires_at_epoch)`;
}

/** Convierte una fila PostgreSQL de invitación a la entidad de aplicación. */
function mapInvite(row: InviteRow): CloudInvite {
  return {
    id: row.id,
    hostUserId: row.host_user_id,
    inviteeUserId: row.invitee_user_id,
    token: row.token,
    wsUrl: row.ws_url,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    rejectedAt: row.rejected_at,
    revokedAt: row.revoked_at,
  };
}

/** Convierte una fila PostgreSQL de membresía a la entidad de aplicación. */
function mapMembership(row: MembershipRow): CloudMembership {
  return {
    hostUserId: row.host_user_id,
    memberUserId: row.member_user_id,
    invitedById: row.invited_by_id,
    wsUrl: row.ws_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    active: row.active,
    scheduledDeletionAt: row.scheduled_deletion_at,
    scheduledDeletionBy: row.scheduled_deletion_by,
  };
}
