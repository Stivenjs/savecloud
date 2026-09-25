import type { SaveRepository } from "@domain/ports/SaveRepository";

export interface DeleteGameFromCloudInput {
  userId: string;
  gameId: string;
  permanent?: boolean;
}

/**
 * Caso de uso: borrar todos los guardados de un juego en S3 (prefijo userId/gameId/).
 */
export class DeleteGameFromCloudUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: DeleteGameFromCloudInput): Promise<void> {
    await this.saveRepository.deleteGame(input.userId, input.gameId, { permanent: input.permanent });
  }
}
