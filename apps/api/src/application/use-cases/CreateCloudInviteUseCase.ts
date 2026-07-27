import type { CloudInvite } from "@domain/entities/CloudInvite";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";

export interface CreateCloudInviteInput {
  hostUserId: string;
  inviteeUserId?: string;
  expiresInDays?: number;
  withToken?: boolean;
  wsUrl?: string;
}

export class CreateCloudInviteUseCase {
  constructor(private readonly repository: CloudInviteRepository) {}

  async execute(input: CreateCloudInviteInput): Promise<CloudInvite> {
    const host = input.hostUserId.trim();
    const invitee = input.inviteeUserId?.trim();
    if (invitee && invitee === host) {
      throw new Error("You cannot invite yourself");
    }

    // Política de invitaciones pendientes antes de ser aceptadas: hasta 365 días de vigencia (por defecto 30 días).
    const ttlDays = Math.max(1, Math.min(input.expiresInDays ?? 30, 365));
    return this.repository.createInvite({
      hostUserId: host,
      inviteeUserId: invitee || undefined,
      ttlSeconds: ttlDays * 24 * 60 * 60,
      withToken: input.withToken ?? true,
      wsUrl: input.wsUrl,
    });
  }
}
