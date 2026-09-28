import type { SaveRepository } from "@domain/ports/SaveRepository";
import { ApplicationError } from "@application/errors/ApplicationError";

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
    const prefix = `${input.userId}/${input.gameId}/`;
    const key = input.key.trim();
    if ((!key.startsWith(`${prefix}backups/`) && !key.startsWith(`${prefix}__torrent__/`)) || key.includes("..")) {
      throw new ApplicationError("INVALID_ARGUMENT", "La clave no pertenece a un backup del usuario y juego.");
    }
    await this.saveRepository.deleteBackup(input.userId, input.gameId, input.key);
  }
}
