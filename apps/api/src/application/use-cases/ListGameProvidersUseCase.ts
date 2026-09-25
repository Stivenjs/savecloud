import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { GameInventoryRepository } from "@domain/ports/GameInventoryRepository";
import type { GameProviderDevice } from "@domain/entities/GameInventory";

export interface ListGameProvidersInput {
  requesterUserId: string;
  gameKey: string;
}

export interface ListGameProvidersResult {
  gameKey: string;
  providers: GameProviderDevice[];
}

export class ListGameProvidersUseCase {
  constructor(
    private readonly inventoryRepository: GameInventoryRepository,
    private readonly cloudInviteRepository: CloudInviteRepository
  ) {}

  async execute(input: ListGameProvidersInput): Promise<ListGameProvidersResult> {
    const requesterId = input.requesterUserId.trim();
    const gameKey = input.gameKey.trim();
    if (!requesterId || !gameKey) {
      throw new Error("requesterUserId and gameKey are required");
    }

    const hostUserId = await this.resolveActiveHostUserId(requesterId);
    const providers = await this.inventoryRepository.listProvidersForGame(hostUserId, gameKey, requesterId);

    const enriched = await Promise.all(
      providers.map(async (p) => {
        const record = await this.inventoryRepository.getDeviceRecord(p.userId, p.deviceId);
        const game = record?.games.find((g) => g.gameKey === gameKey);
        return {
          ...p,
          files: game?.files ?? [],
        };
      })
    );

    return { gameKey, providers: enriched };
  }

  private async resolveActiveHostUserId(userId: string): Promise<string> {
    const memberships = await this.cloudInviteRepository.listMembershipsForMember(userId);
    const active = memberships.find((m) => m.active);
    if (active) return active.hostUserId;
    return userId;
  }
}
