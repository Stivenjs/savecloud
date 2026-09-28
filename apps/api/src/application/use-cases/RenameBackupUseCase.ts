import type { SaveRepository } from "@domain/ports/SaveRepository";
import { ApplicationError } from "@application/errors/ApplicationError";

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
    const prefix = `${input.userId}/${input.gameId}/backups/`;
    const key = input.key.trim();
    const newFilename = input.newFilename.trim();
    if (!key.startsWith(prefix) || key.includes("..")) {
      throw new ApplicationError("INVALID_ARGUMENT", "La clave no pertenece a un backup del usuario y juego.");
    }
    if (!newFilename || newFilename.includes("/") || newFilename.includes("..") || !newFilename.endsWith(".tar")) {
      throw new ApplicationError("INVALID_ARGUMENT", "El nombre debe ser un archivo .tar sin rutas.");
    }
    await this.saveRepository.renameBackup(input.userId, input.gameId, key, newFilename);
  }
}
