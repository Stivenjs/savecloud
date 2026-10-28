import { ApplicationError } from "@application/errors/ApplicationError";
import type { GameInventoryRepository } from "@domain/ports/GameInventoryRepository";

export class ConsumeTransferSessionUseCase {
  constructor(private readonly repository: GameInventoryRepository) {}

  async execute(sessionId: string, requesterUserId: string): Promise<void> {
    const cleanSessionId = sessionId.trim();
    const cleanRequesterUserId = requesterUserId.trim();
    if (!cleanSessionId || !cleanRequesterUserId) {
      throw new ApplicationError("INVALID_ARGUMENT", "Faltan datos para cerrar la sesión de transferencia.");
    }

    const result = await this.repository.consumeTransferSession(cleanSessionId, cleanRequesterUserId);
    if (result === "forbidden") {
      throw new ApplicationError("FORBIDDEN", "No puedes cerrar esta sesión de transferencia.");
    }
  }
}
