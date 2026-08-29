/**
 * @fileoverview Caso de uso para restaurar un juego desde la papelera de reciclaje.
 *
 * @module application/use-cases/RestoreFromTrashUseCase
 */

import type { SaveRepository } from "@domain/ports/SaveRepository";

export interface RestoreFromTrashInput {
  userId: string;
  gameId: string;
}

export class RestoreFromTrashUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: RestoreFromTrashInput): Promise<void> {
    await this.saveRepository.restoreFromTrash(input.userId, input.gameId);
  }
}
