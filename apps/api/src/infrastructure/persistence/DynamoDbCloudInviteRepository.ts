/**
 * @fileoverview Repositorio de invitaciones y membresías de SaveCloud respaldado por DynamoDB.
 *
 * Implementa CloudInviteRepository con operaciones atómicas, soporte de índices secundarios globales (GSI1)
 * y mecanismo de fallback transparente hacia S3 para soportar migraciones en caliente sin downtime.
 *
 * @module infrastructure/persistence/DynamoDbCloudInviteRepository
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import crypto from "node:crypto";
import type { CloudInvite, CloudMembership } from "@domain/entities/CloudInvite";
import type { CloudInviteRepository, CreateInviteInput } from "@domain/ports/CloudInviteRepository";
import type { S3CloudInviteRepository } from "./S3CloudInviteRepository";

/**
 * Registro de base de datos para una invitación.
 */
interface InviteDbRecord {
  pk: string;
  sk: string;
  gsi1pk?: string;
  gsi1sk?: string;
  entityType: "INVITE";
  id: string;
  hostUserId: string;
  inviteeUserId: string | null;
  token: string | null;
  wsUrl?: string | null;
  status: CloudInvite["status"];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  expiresAtEpoch: number;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  revokedAt?: string | null;
}

/**
 * Registro de base de datos para una membresía de grupo.
 */
interface MembershipDbRecord {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  entityType: "MEMBERSHIP";
  hostUserId: string;
  memberUserId: string;
  invitedById: string;
  wsUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

/**
 * Registro de base de datos para ACL de juego compartido.
 */
interface GameShareDbRecord {
  pk: string;
  sk: string;
  entityType: "GAME_SHARE";
  hostUserId: string;
  memberUserId: string;
  gameId: string;
  createdAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Implementación de CloudInviteRepository sobre Amazon DynamoDB.
 */
export class DynamoDbCloudInviteRepository implements CloudInviteRepository {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    dynamoClient: DynamoDBClient,
    private readonly tableName: string,
    private readonly s3Fallback?: S3CloudInviteRepository
  ) {
    this.docClient = DynamoDBDocumentClient.from(dynamoClient, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  /**
   * Crea una nueva invitación en DynamoDB con índice secundario por token o invitado.
   */
  async createInvite(input: CreateInviteInput): Promise<CloudInvite> {
    const now = nowIso();
    const ttl = Math.max(60, input.ttlSeconds);
    const expiresAtDate = new Date(Date.now() + ttl * 1000);
    const expiresAt = expiresAtDate.toISOString();
    const expiresAtEpoch = Math.floor(expiresAtDate.getTime() / 1000);

    const inviteId = crypto.randomUUID();
    const hostUserId = input.hostUserId.trim();
    const inviteeUserId = input.inviteeUserId?.trim() || null;
    const token = input.withToken ? crypto.randomBytes(24).toString("hex") : null;

    const invite: CloudInvite = {
      id: inviteId,
      hostUserId,
      inviteeUserId,
      token,
      wsUrl: input.wsUrl ?? null,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      expiresAt,
      acceptedAt: null,
      rejectedAt: null,
      revokedAt: null,
    };

    const record: InviteDbRecord = {
      pk: `INVITE#${inviteId}`,
      sk: "METADATA",
      entityType: "INVITE",
      id: inviteId,
      hostUserId,
      inviteeUserId,
      token,
      wsUrl: input.wsUrl ?? null,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      expiresAt,
      expiresAtEpoch,
      acceptedAt: null,
      rejectedAt: null,
      revokedAt: null,
    };

    if (token) {
      record.gsi1pk = `TOKEN#${token}`;
      record.gsi1sk = `INVITE#${inviteId}`;
    } else if (inviteeUserId) {
      record.gsi1pk = `INVITEE#${inviteeUserId}`;
      record.gsi1sk = `INVITE#${inviteId}`;
    }

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
      })
    );

    return invite;
  }

  /**
   * Obtiene una invitación por su ID único.
   */
  async getInviteById(id: string): Promise<CloudInvite | null> {
    const res = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `INVITE#${id}`,
          sk: "METADATA",
        },
      })
    );

    if (res.Item) {
      const item = res.Item as InviteDbRecord;
      if (item.expiresAt <= nowIso()) return null;
      return this.mapInviteRecord(item);
    }

    if (this.s3Fallback) {
      return this.s3Fallback.getInviteById(id);
    }

    return null;
  }

  /**
   * Obtiene una invitación resolviendo su token público mediante GSI1.
   */
  async getInviteByToken(token: string): Promise<CloudInvite | null> {
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "GSI1",
        KeyConditionExpression: "gsi1pk = :tokenPk",
        ExpressionAttributeValues: {
          ":tokenPk": `TOKEN#${token.trim()}`,
        },
        Limit: 1,
      })
    );

    if (res.Items && res.Items.length > 0) {
      const item = res.Items[0] as InviteDbRecord;
      if (item.expiresAt <= nowIso()) return null;
      return this.mapInviteRecord(item);
    }

    if (this.s3Fallback) {
      return this.s3Fallback.getInviteByToken(token);
    }

    return null;
  }

  /**
   * Lista las invitaciones pendientes para un usuario destinatario.
   */
  async listPendingInvitesForUser(userId: string): Promise<CloudInvite[]> {
    const normalized = userId.trim();
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "GSI1",
        KeyConditionExpression: "gsi1pk = :inviteePk",
        ExpressionAttributeValues: {
          ":inviteePk": `INVITEE#${normalized}`,
        },
      })
    );

    const now = nowIso();
    const dynamoInvites: CloudInvite[] = [];

    if (res.Items && res.Items.length > 0) {
      for (const raw of res.Items) {
        const item = raw as InviteDbRecord;
        if (item.status === "pending" && item.expiresAt > now) {
          dynamoInvites.push(this.mapInviteRecord(item));
        }
      }
    }

    if (dynamoInvites.length === 0 && this.s3Fallback) {
      return this.s3Fallback.listPendingInvitesForUser(userId);
    }

    return dynamoInvites;
  }

  /**
   * Actualiza el estado y metadatos de una invitación.
   */
  async updateInvite(invite: CloudInvite): Promise<void> {
    const expiresAtEpoch = Math.floor(new Date(invite.expiresAt).getTime() / 1000);
    const record: InviteDbRecord = {
      pk: `INVITE#${invite.id}`,
      sk: "METADATA",
      entityType: "INVITE",
      id: invite.id,
      hostUserId: invite.hostUserId,
      inviteeUserId: invite.inviteeUserId,
      token: invite.token,
      wsUrl: invite.wsUrl,
      status: invite.status,
      createdAt: invite.createdAt,
      updatedAt: invite.updatedAt || nowIso(),
      expiresAt: invite.expiresAt,
      expiresAtEpoch,
      acceptedAt: invite.acceptedAt ?? null,
      rejectedAt: invite.rejectedAt ?? null,
      revokedAt: invite.revokedAt ?? null,
    };

    if (invite.token) {
      record.gsi1pk = `TOKEN#${invite.token}`;
      record.gsi1sk = `INVITE#${invite.id}`;
    } else if (invite.inviteeUserId) {
      record.gsi1pk = `INVITEE#${invite.inviteeUserId}`;
      record.gsi1sk = `INVITE#${invite.id}`;
    }

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
      })
    );
  }

  /**
   * Guarda o actualiza una membresía de forma atómica.
   */
  async upsertMembership(membership: CloudMembership): Promise<void> {
    const record: MembershipDbRecord = {
      pk: `HOST#${membership.hostUserId}`,
      sk: `MEMBER#${membership.memberUserId}`,
      gsi1pk: `MEMBER#${membership.memberUserId}`,
      gsi1sk: `HOST#${membership.hostUserId}`,
      entityType: "MEMBERSHIP",
      hostUserId: membership.hostUserId,
      memberUserId: membership.memberUserId,
      invitedById: membership.invitedById,
      wsUrl: membership.wsUrl ?? null,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt || nowIso(),
      active: membership.active,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
      })
    );
  }

  /**
   * Obtiene una membresía específica entre un host y un miembro.
   */
  async getMembership(hostUserId: string, memberUserId: string): Promise<CloudMembership | null> {
    const res = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `HOST#${hostUserId}`,
          sk: `MEMBER#${memberUserId}`,
        },
      })
    );

    if (res.Item) {
      return this.mapMembershipRecord(res.Item as MembershipDbRecord);
    }

    if (this.s3Fallback) {
      return this.s3Fallback.getMembership(hostUserId, memberUserId);
    }

    return null;
  }

  /**
   * Lista todas las membresías activas para un miembro a través del índice GSI1.
   */
  async listMembershipsForMember(memberUserId: string): Promise<CloudMembership[]> {
    const normalized = memberUserId.trim();
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "GSI1",
        KeyConditionExpression: "gsi1pk = :memberPk AND begins_with(gsi1sk, :hostPrefix)",
        ExpressionAttributeValues: {
          ":memberPk": `MEMBER#${normalized}`,
          ":hostPrefix": "HOST#",
        },
      })
    );

    const dynamoMemberships: CloudMembership[] = [];
    if (res.Items && res.Items.length > 0) {
      for (const item of res.Items) {
        const mapped = this.mapMembershipRecord(item as MembershipDbRecord);
        if (mapped.active) {
          dynamoMemberships.push(mapped);
        }
      }
    }

    if (dynamoMemberships.length === 0 && this.s3Fallback) {
      const fallbackItems = await this.s3Fallback.listMembershipsForMember(memberUserId);
      if (fallbackItems.length > 0) {
        // Auto-migración en background
        for (const item of fallbackItems) {
          this.upsertMembership(item).catch((err) => {
            console.warn("[DynamoDbCloudInviteRepository] Error auto-migrando membresia:", err);
          });
        }
        return fallbackItems;
      }
    }

    return dynamoMemberships;
  }

  /**
   * Lista todas las membresías vinculadas a un host.
   */
  async listMembershipsForHost(hostUserId: string): Promise<CloudMembership[]> {
    const normalized = hostUserId.trim();
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :hostPk AND begins_with(sk, :memberPrefix)",
        ExpressionAttributeValues: {
          ":hostPk": `HOST#${normalized}`,
          ":memberPrefix": "MEMBER#",
        },
      })
    );

    const dynamoMemberships: CloudMembership[] = [];
    if (res.Items && res.Items.length > 0) {
      for (const item of res.Items) {
        dynamoMemberships.push(this.mapMembershipRecord(item as MembershipDbRecord));
      }
    }

    if (dynamoMemberships.length === 0 && this.s3Fallback) {
      return this.s3Fallback.listMembershipsForHost(hostUserId);
    }

    return dynamoMemberships;
  }

  /**
   * Configura si un juego está compartido con un miembro específico.
   */
  async setGameShared(hostUserId: string, memberUserId: string, gameId: string, shared: boolean): Promise<void> {
    const pk = `HOST#${hostUserId.trim()}`;
    const sk = `SHARE#${memberUserId.trim()}#${gameId.trim()}`;

    if (shared) {
      const record: GameShareDbRecord = {
        pk,
        sk,
        entityType: "GAME_SHARE",
        hostUserId: hostUserId.trim(),
        memberUserId: memberUserId.trim(),
        gameId: gameId.trim(),
        createdAt: nowIso(),
      };
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: record,
        })
      );
    } else {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { pk, sk },
        })
      );
    }
  }

  /**
   * Comprueba si un juego está compartido con un miembro.
   */
  async isGameSharedWithMember(hostUserId: string, memberUserId: string, gameId: string): Promise<boolean> {
    const res = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          pk: `HOST#${hostUserId.trim()}`,
          sk: `SHARE#${memberUserId.trim()}#${gameId.trim()}`,
        },
      })
    );

    if (res.Item) return true;

    if (this.s3Fallback) {
      return this.s3Fallback.isGameSharedWithMember(hostUserId, memberUserId, gameId);
    }

    return false;
  }

  /**
   * Lista todos los IDs de juegos compartidos con un miembro.
   */
  async listSharedGamesForMember(hostUserId: string, memberUserId: string): Promise<string[]> {
    const res = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "pk = :hostPk AND begins_with(sk, :sharePrefix)",
        ExpressionAttributeValues: {
          ":hostPk": `HOST#${hostUserId.trim()}`,
          ":sharePrefix": `SHARE#${memberUserId.trim()}#`,
        },
      })
    );

    const games: string[] = [];
    if (res.Items && res.Items.length > 0) {
      for (const raw of res.Items) {
        const item = raw as GameShareDbRecord;
        if (item.gameId) {
          games.push(item.gameId);
        }
      }
      return games.sort();
    }

    if (this.s3Fallback) {
      return this.s3Fallback.listSharedGamesForMember(hostUserId, memberUserId);
    }

    return [];
  }

  /**
   * Desactiva de forma atómica una membresía.
   */
  async deactivateMembership(hostUserId: string, memberUserId: string): Promise<void> {
    const now = nowIso();
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          pk: `HOST#${hostUserId.trim()}`,
          sk: `MEMBER#${memberUserId.trim()}`,
        },
        UpdateExpression: "SET active = :active, updatedAt = :updatedAt",
        ExpressionAttributeValues: {
          ":active": false,
          ":updatedAt": now,
        },
      })
    );
  }

  private mapInviteRecord(item: InviteDbRecord): CloudInvite {
    return {
      id: item.id,
      hostUserId: item.hostUserId,
      inviteeUserId: item.inviteeUserId ?? null,
      token: item.token ?? null,
      wsUrl: item.wsUrl ?? null,
      status: item.status,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      expiresAt: item.expiresAt,
      acceptedAt: item.acceptedAt ?? null,
      rejectedAt: item.rejectedAt ?? null,
      revokedAt: item.revokedAt ?? null,
    };
  }

  private mapMembershipRecord(item: MembershipDbRecord): CloudMembership {
    return {
      hostUserId: item.hostUserId,
      memberUserId: item.memberUserId,
      invitedById: item.invitedById,
      wsUrl: item.wsUrl ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      active: item.active,
    };
  }
}
