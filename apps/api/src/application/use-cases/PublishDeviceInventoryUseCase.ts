import type { GameInventoryRepository, PublishDeviceInventoryInput } from "@domain/ports/GameInventoryRepository";

export class PublishDeviceInventoryUseCase {
  constructor(private readonly repository: GameInventoryRepository) {}

  async execute(input: PublishDeviceInventoryInput): Promise<void> {
    if (!input.userId.trim() || !input.deviceId.trim()) {
      throw new Error("userId and deviceId are required");
    }
    if (!input.sharingEnabled) {
      await this.repository.deleteDeviceInventory(input.userId, input.deviceId);
      return;
    }
    const verified = input.games.filter((g) => g.status === "verified" && g.gameKey.trim());
    if (verified.length !== input.games.length) {
      throw new Error("Only verified game entries may be published");
    }
    await this.repository.putDeviceInventory({ ...input, games: verified });
  }
}
