import type { SaveRepository } from "@domain/ports/SaveRepository";

export interface DeleteBackupInput {
  userId: string;
  gameId: string;
  key: string;
}

/**
 * Caso de uso: borrar un backup (archivo .tar) por key.
 * La key debe pertenecer a userId/gameId/backups/.
 */
export class DeleteBackupUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: DeleteBackupInput): Promise<void> {
    await this.saveRepository.deleteBackup(
      input.userId,
      input.gameId,
      input.key
    );
  }
}
