import { ApplicationError } from "@application/errors/ApplicationError";
import type { GameInventoryRepository } from "@domain/ports/GameInventoryRepository";
import type { TransferSessionRecord } from "@domain/ports/GameInventoryRepository";

export class ListPendingTransferSessionsUseCase {
  constructor(private readonly repository: GameInventoryRepository) {}

  async execute(targetDeviceId: string): Promise<TransferSessionRecord[]> {
    const deviceId = targetDeviceId.trim();
    if (!deviceId) throw new ApplicationError("INVALID_ARGUMENT", "El identificador del dispositivo es obligatorio.");
    return this.repository.listPendingTransferSessions(deviceId);
  }
}
