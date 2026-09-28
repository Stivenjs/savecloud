import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { ResolveCloudStorageScopeUseCase } from "@application/use-cases/ResolveCloudStorageScopeUseCase";

export class ResolveTargetStorageUserIdUseCase {
  constructor(
    private readonly cloudInviteRepository: CloudInviteRepository,
    private readonly resolveCloudStorageScopeUseCase: ResolveCloudStorageScopeUseCase
  ) {}

  async execute(targetUserId: string): Promise<string> {
    const memberships = await this.cloudInviteRepository.listMembershipsForMember(targetUserId);
    const activeMembership = memberships.find((membership) => membership.active);
    if (!activeMembership) return targetUserId;

    const scope = await this.resolveCloudStorageScopeUseCase.execute(targetUserId, activeMembership.hostUserId);
    return scope.storageUserId;
  }
}
