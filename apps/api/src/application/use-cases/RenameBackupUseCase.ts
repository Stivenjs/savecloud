import type { SaveRepository } from "@domain/ports/SaveRepository";

export interface RenameBackupInput {
  userId: string;
  gameId: string;
  key: string;
  newFilename: string;
}

/**
 * Caso de uso: renombrar un backup (copia a nuevo key y borra el antiguo).
 * newFilename debe ser solo el nombre del archivo .tar, sin rutas.
 */
export class RenameBackupUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: RenameBackupInput): Promise<void> {
    await this.saveRepository.renameBackup(input.userId, input.gameId, input.key, input.newFilename.trim());
  }
}
