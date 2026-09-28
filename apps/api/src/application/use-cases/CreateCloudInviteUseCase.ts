import type { CloudInvite } from "@domain/entities/CloudInvite";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import { ApplicationError } from "@application/errors/ApplicationError";

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
      throw new ApplicationError("INVALID_ARGUMENT", "No puedes enviarte una invitación a ti mismo.");
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
