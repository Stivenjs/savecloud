/**
 * @fileoverview Caso de uso para vaciar completamente la papelera de reciclaje de un usuario.
 *
 * @module application/use-cases/EmptyTrashUseCase
 */

import type { SaveRepository } from "@domain/ports/SaveRepository";

export interface EmptyTrashInput {
  userId: string;
}

export class EmptyTrashUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: EmptyTrashInput): Promise<void> {
    await this.saveRepository.emptyTrash(input.userId);
  }
}
