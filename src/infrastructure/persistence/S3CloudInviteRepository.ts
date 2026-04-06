import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import crypto from "crypto";
import type { CloudInvite, CloudMembership } from "@domain/entities/CloudInvite";
import type { CloudInviteRepository, CreateInviteInput } from "@domain/ports/CloudInviteRepository";

interface MembershipFile {
  version: 1;
  items: CloudMembership[];
}

interface SharedGamesFile {
  version: 1;
  gameIds: string[];
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class S3CloudInviteRepository implements CloudInviteRepository {
  constructor(
    private readonly s3: S3Client,
    private readonly bucketName: string
  ) {}

  private inviteItemKey(inviteId: string): string {
    return `cloud-invites/items/${inviteId}.json`;
  }

  private tokenIndexKey(token: string): string {
    return `cloud-invites/tokens/${token}.json`;
  }

  private inviteeIndexKey(inviteeUserId: string, inviteId: string): string {
    return `cloud-invites/invitees/${inviteeUserId}/${inviteId}.json`;
  }

  private membershipsKey(hostUserId: string): string {
    return `cloud-invites-memberships/${hostUserId}.json`;
  }

  private sharedGamesKey(hostUserId: string, memberUserId: string): string {
    return `cloud-invites-shared-games/${hostUserId}/${memberUserId}.json`;
  }

  private async getJsonOrNull<T>(key: string): Promise<T | null> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucketName, Key: key }));
      const raw = await res.Body?.transformToString();
      if (!raw?.trim()) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  private async putJson(key: string, value: unknown): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: "application/json",
      })
    );
  }

  private async listKeys(prefix: string): Promise<string[]> {
    const out: string[] = [];
    let continuationToken: string | undefined;
    do {
      const res = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucketName,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );
      for (const item of res.Contents ?? []) {
        if (item.Key) out.push(item.Key);
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (continuationToken);
    return out;
  }

  private async loadMembershipFile(hostUserId: string): Promise<MembershipFile> {
    try {
      const parsed = await this.getJsonOrNull<MembershipFile>(this.membershipsKey(hostUserId));
      if (!parsed) return { version: 1, items: [] };
      if (!Array.isArray(parsed.items)) return { version: 1, items: [] };
      return { version: 1, items: parsed.items };
    } catch (err) {
      if (isNotFound(err)) return { version: 1, items: [] };
      throw err;
    }
  }

  private async saveMembershipFile(hostUserId: string, file: MembershipFile): Promise<void> {
    await this.putJson(this.membershipsKey(hostUserId), file);
  }

  private async loadSharedGames(hostUserId: string, memberUserId: string): Promise<SharedGamesFile> {
    try {
      const parsed = await this.getJsonOrNull<SharedGamesFile>(this.sharedGamesKey(hostUserId, memberUserId));
      if (!parsed) return { version: 1, gameIds: [] };
      if (!Array.isArray(parsed.gameIds)) return { version: 1, gameIds: [] };
      return { version: 1, gameIds: parsed.gameIds };
    } catch (err) {
      if (isNotFound(err)) return { version: 1, gameIds: [] };
      throw err;
    }
  }

  private async saveSharedGames(hostUserId: string, memberUserId: string, file: SharedGamesFile): Promise<void> {
    await this.putJson(this.sharedGamesKey(hostUserId, memberUserId), file);
  }

  async createInvite(input: CreateInviteInput): Promise<CloudInvite> {
    const now = nowIso();
    const ttl = Math.max(60, input.ttlSeconds);
    const invite: CloudInvite = {
      id: crypto.randomUUID(),
      hostUserId: input.hostUserId.trim(),
      inviteeUserId: input.inviteeUserId?.trim() || null,
      token: input.withToken ? crypto.randomBytes(24).toString("hex") : null,
      wsUrl: input.wsUrl,
      status: "pending",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      acceptedAt: null,
      rejectedAt: null,
      revokedAt: null,
    };
    await this.putJson(this.inviteItemKey(invite.id), invite);
    if (invite.token) {
      await this.putJson(this.tokenIndexKey(invite.token), {
        inviteId: invite.id,
        expiresAt: invite.expiresAt,
      });
    }
    if (invite.inviteeUserId) {
      await this.putJson(this.inviteeIndexKey(invite.inviteeUserId, invite.id), {
        inviteId: invite.id,
        expiresAt: invite.expiresAt,
      });
    }
    return invite;
  }

  async listPendingInvitesForUser(userId: string): Promise<CloudInvite[]> {
    const normalized = userId.trim();
    const inviteeKeys = await this.listKeys(`cloud-invites/invitees/${normalized}/`);
    const now = nowIso();
    const invites = await Promise.all(
      inviteeKeys.map(async (idxKey) => {
        const marker = await this.getJsonOrNull<{ inviteId: string }>(idxKey);
        if (!marker?.inviteId) return null;
        return this.getInviteById(marker.inviteId);
      })
    );
    return invites.filter((x): x is CloudInvite => !!x && x.status === "pending" && x.expiresAt > now);
  }

  async getInviteById(id: string): Promise<CloudInvite | null> {
    const invite = await this.getJsonOrNull<CloudInvite>(this.inviteItemKey(id));
    if (!invite) return null;
    if (invite.expiresAt <= nowIso()) return null;
    return invite;
  }

  async getInviteByToken(token: string): Promise<CloudInvite | null> {
    const marker = await this.getJsonOrNull<{ inviteId: string; expiresAt?: string }>(this.tokenIndexKey(token));
    if (!marker?.inviteId) return null;
    if (marker.expiresAt && marker.expiresAt <= nowIso()) return null;
    return this.getInviteById(marker.inviteId);
  }

  async updateInvite(invite: CloudInvite): Promise<void> {
    await this.putJson(this.inviteItemKey(invite.id), invite);
    if (invite.token) {
      await this.putJson(this.tokenIndexKey(invite.token), {
        inviteId: invite.id,
        expiresAt: invite.expiresAt,
      });
    }
    if (invite.inviteeUserId) {
      await this.putJson(this.inviteeIndexKey(invite.inviteeUserId, invite.id), {
        inviteId: invite.id,
        expiresAt: invite.expiresAt,
      });
    }
  }

  async upsertMembership(membership: CloudMembership): Promise<void> {
    const file = await this.loadMembershipFile(membership.hostUserId);
    const idx = file.items.findIndex((x) => x.memberUserId === membership.memberUserId);
    if (idx < 0) file.items.push(membership);
    else file.items[idx] = membership;
    await this.saveMembershipFile(membership.hostUserId, file);
  }

  async getMembership(hostUserId: string, memberUserId: string): Promise<CloudMembership | null> {
    const file = await this.loadMembershipFile(hostUserId);
    return file.items.find((x) => x.memberUserId === memberUserId) ?? null;
  }

  async listMembershipsForMember(memberUserId: string): Promise<CloudMembership[]> {
    const inviteeKeys = await this.listKeys(`cloud-invites/invitees/${memberUserId}/`);
    const hosts = new Set<string>();
    for (const idxKey of inviteeKeys) {
      const marker = await this.getJsonOrNull<{ inviteId: string }>(idxKey);
      if (!marker?.inviteId) continue;
      const invite = await this.getInviteById(marker.inviteId);
      if (invite?.inviteeUserId === memberUserId) hosts.add(invite.hostUserId);
    }
    const out: CloudMembership[] = [];
    for (const host of hosts) {
      const membership = await this.getMembership(host, memberUserId);
      if (membership) out.push(membership);
    }
    return out;
  }

  async listMembershipsForHost(hostUserId: string): Promise<CloudMembership[]> {
    const file = await this.loadMembershipFile(hostUserId);
    return file.items;
  }

  async setGameShared(hostUserId: string, memberUserId: string, gameId: string, shared: boolean): Promise<void> {
    const file = await this.loadSharedGames(hostUserId, memberUserId);
    const normalizedGameId = gameId.trim();
    const set = new Set(file.gameIds.map((x) => x.trim()).filter(Boolean));
    if (shared) set.add(normalizedGameId);
    else set.delete(normalizedGameId);
    await this.saveSharedGames(hostUserId, memberUserId, { version: 1, gameIds: [...set].sort() });
  }

  async isGameSharedWithMember(hostUserId: string, memberUserId: string, gameId: string): Promise<boolean> {
    const file = await this.loadSharedGames(hostUserId, memberUserId);
    return file.gameIds.some((x) => x === gameId.trim());
  }

  async listSharedGamesForMember(hostUserId: string, memberUserId: string): Promise<string[]> {
    const file = await this.loadSharedGames(hostUserId, memberUserId);
    return file.gameIds;
  }

  async deactivateMembership(hostUserId: string, memberUserId: string): Promise<void> {
    const file = await this.loadMembershipFile(hostUserId);
    const idx = file.items.findIndex((x) => x.memberUserId === memberUserId);
    if (idx < 0) return;
    const current = file.items[idx];
    file.items[idx] = {
      ...current,
      active: false,
      updatedAt: nowIso(),
    };
    await this.saveMembershipFile(hostUserId, file);
  }
}
