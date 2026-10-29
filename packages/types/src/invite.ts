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
  wsUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  active: boolean;
  /**
   * ISO timestamp en el que se ejecutará la purga real de datos (S3 + DynamoDB).
   * `null` o ausente significa que no hay eliminación programada.
   */
  scheduledDeletionAt?: string | null;
  /** userId del host que programó la eliminación. */
  scheduledDeletionBy?: string | null;
}

export interface GameShareAcl {
  hostUserId: string;
  memberUserId: string;
  gameId: string;
  createdAt: string;
}
