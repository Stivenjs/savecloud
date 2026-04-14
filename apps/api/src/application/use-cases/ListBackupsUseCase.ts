import type { BackupMetadata } from "@domain/ports/SaveRepository";
import type { SaveRepository } from "@domain/ports/SaveRepository";

export interface ListBackupsInput {
  userId: string;
  gameId: string;
}

export interface ListBackupsOutput {
  backups: BackupMetadata[];
}

/**
 * Caso de uso: listar backups (archivos .tar) de un juego en S3.
 * Solo objetos bajo userId/gameId/backups/.
 */
export class ListBackupsUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: ListBackupsInput): Promise<ListBackupsOutput> {
    const backups = await this.saveRepository.listBackups(input.userId, input.gameId);
    return { backups };
  }
}
