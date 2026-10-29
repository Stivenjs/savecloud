import { ApplicationError } from "@application/errors/ApplicationError";
import type { GameInventoryRepository } from "@domain/ports/GameInventoryRepository";
import type { TransferSessionRecord } from "@domain/ports/GameInventoryRepository";

export class ListPendingTransferSessionsUseCase {
  constructor(private readonly repository: GameInventoryRepository) {}

  async execute(targetUserId: string, targetDeviceId: string): Promise<TransferSessionRecord[]> {
    const userId = targetUserId.trim();
    const deviceId = targetDeviceId.trim();
    if (!userId) throw new ApplicationError("UNAUTHENTICATED", "Falta el usuario autenticado.");
    if (!deviceId) throw new ApplicationError("INVALID_ARGUMENT", "El identificador del dispositivo es obligatorio.");
    return this.repository.listPendingTransferSessions(userId, deviceId);
  }
}
