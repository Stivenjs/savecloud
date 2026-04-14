import type { CloudInvite, CloudMembership } from "@domain/entities/CloudInvite";

export interface CreateInviteInput {
  hostUserId: string;
  inviteeUserId?: string;
  ttlSeconds: number;
  withToken: boolean;
  wsUrl?: string;
}

export interface CloudInviteRepository {
  createInvite(input: CreateInviteInput): Promise<CloudInvite>;
  listPendingInvitesForUser(userId: string): Promise<CloudInvite[]>;
  getInviteById(id: string): Promise<CloudInvite | null>;
  getInviteByToken(token: string): Promise<CloudInvite | null>;
  updateInvite(invite: CloudInvite): Promise<void>;
  upsertMembership(membership: CloudMembership): Promise<void>;
  getMembership(hostUserId: string, memberUserId: string): Promise<CloudMembership | null>;
  listMembershipsForMember(memberUserId: string): Promise<CloudMembership[]>;
  listMembershipsForHost(hostUserId: string): Promise<CloudMembership[]>;
  setGameShared(hostUserId: string, memberUserId: string, gameId: string, shared: boolean): Promise<void>;
  isGameSharedWithMember(hostUserId: string, memberUserId: string, gameId: string): Promise<boolean>;
  listSharedGamesForMember(hostUserId: string, memberUserId: string): Promise<string[]>;
  deactivateMembership(hostUserId: string, memberUserId: string): Promise<void>;
}
