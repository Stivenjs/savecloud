import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";

export interface ResolvedCloudScope {
  requestUserId: string;
  hostUserId: string;
  storageUserId: string;
  isMemberCloud: boolean;
}

export class ResolveCloudStorageScopeUseCase {
  constructor(private readonly repository: CloudInviteRepository) {}

  async execute(requestUserId: string, requestedHostUserId?: string): Promise<ResolvedCloudScope> {
    const userId = requestUserId.trim();
    const host = requestedHostUserId?.trim();

    if (!host || host === userId) {
      return {
        requestUserId: userId,
        hostUserId: userId,
        storageUserId: userId,
        isMemberCloud: false,
      };
    }

    const membership = await this.repository.getMembership(host, userId);
    if (!membership || !membership.active) {
      throw new Error("User has no active membership in requested host cloud");
    }

    return {
      requestUserId: userId,
      hostUserId: host,
      storageUserId: `${host}::member::${userId}`,
      isMemberCloud: true,
    };
  }
}
