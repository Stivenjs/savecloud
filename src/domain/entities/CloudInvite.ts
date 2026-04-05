export type CloudInviteStatus = "pending" | "accepted" | "rejected" | "revoked" | "expired";

export interface CloudInvite {
  id: string;
  hostUserId: string;
  inviteeUserId: string | null;
  token: string | null;
  wsUrl?: string | null;
  status: CloudInviteStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  revokedAt?: string | null;
}

export interface CloudMembership {
  hostUserId: string;
  memberUserId: string;
  invitedById: string;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

export interface GameShareAcl {
  hostUserId: string;
  memberUserId: string;
  gameId: string;
  createdAt: string;
}
