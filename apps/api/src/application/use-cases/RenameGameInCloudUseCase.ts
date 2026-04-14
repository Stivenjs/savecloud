import type { SaveRepository } from "@domain/ports/SaveRepository";

export interface RenameGameInCloudInput {
  userId: string;
  oldGameId: string;
  newGameId: string;
}

/**
 * Caso de uso: renombrar un juego en S3 (copiar userId/oldGameId/* a userId/newGameId/* y borrar el prefijo antiguo).
 */
export class RenameGameInCloudUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: RenameGameInCloudInput): Promise<void> {
    await this.saveRepository.renameGame(input.userId, input.oldGameId, input.newGameId);
  }
}
