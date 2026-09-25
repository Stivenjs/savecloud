/**
 * @fileoverview Caso de uso para listar los elementos en la papelera de reciclaje de un usuario.
 *
 * @module application/use-cases/ListTrashUseCase
 */

import type { SaveRepository } from "@domain/ports/SaveRepository";
import type { TrashGameItem } from "@savecloud/types";

export interface ListTrashInput {
  userId: string;
}

export class ListTrashUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: ListTrashInput): Promise<TrashGameItem[]> {
    return this.saveRepository.listTrash(input.userId);
  }
}
