import type { GameInventoryRepository, PublishDeviceInventoryInput } from "@domain/ports/GameInventoryRepository";
import { ApplicationError } from "@application/errors/ApplicationError";

export class PublishDeviceInventoryUseCase {
  constructor(private readonly repository: GameInventoryRepository) {}

  async execute(input: PublishDeviceInventoryInput): Promise<void> {
    if (!input.userId.trim() || !input.deviceId.trim()) {
      throw new ApplicationError("INVALID_ARGUMENT", "El usuario y el dispositivo son obligatorios.");
    }
    if (!input.sharingEnabled) {
      await this.repository.deleteDeviceInventory(input.userId, input.deviceId);
      return;
    }
    const verified = input.games.filter((g) => g.status === "verified" && g.gameKey.trim());
    if (verified.length !== input.games.length) {
      throw new ApplicationError("INVALID_ARGUMENT", "Solo se pueden publicar juegos verificados.");
    }
    await this.repository.putDeviceInventory({ ...input, games: verified });
  }
}
