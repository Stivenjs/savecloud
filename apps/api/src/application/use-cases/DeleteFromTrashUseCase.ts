/**
 * @fileoverview Caso de uso para eliminar definitivamente un juego de la papelera de reciclaje.
 *
 * @module application/use-cases/DeleteFromTrashUseCase
 */

import type { SaveRepository } from "@domain/ports/SaveRepository";

export interface DeleteFromTrashInput {
  userId: string;
  gameId: string;
}

export class DeleteFromTrashUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: DeleteFromTrashInput): Promise<void> {
    await this.saveRepository.deleteFromTrash(input.userId, input.gameId);
  }
}
