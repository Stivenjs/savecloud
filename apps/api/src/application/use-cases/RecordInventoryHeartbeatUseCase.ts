import type { GameInventoryRepository } from "@domain/ports/GameInventoryRepository";

export class RecordInventoryHeartbeatUseCase {
  constructor(private readonly repository: GameInventoryRepository) {}

  async execute(userId: string, deviceId: string, appVersion?: string): Promise<void> {
    await this.repository.recordHeartbeat(userId.trim(), deviceId.trim(), appVersion);
  }
}
