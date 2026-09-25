import type { BackupMetadata } from "@domain/ports/SaveRepository";
import type { SaveRepository } from "@domain/ports/SaveRepository";
import type { SaveFileIndexRepository } from "@domain/ports/SaveFileIndexRepository";

export interface ListBackupsInput {
  userId: string;
  gameId: string;
}

export interface ListBackupsOutput {
  backups: BackupMetadata[];
}

/**
 * Caso de uso: listar backups (archivos .tar) de un juego.
 * Consulta primero el índice en DynamoDB para máxima velocidad y cae a S3 si es necesario.
 */
export class ListBackupsUseCase {
  constructor(
    private readonly saveRepository: SaveRepository,
    private readonly saveFileIndexRepository?: SaveFileIndexRepository
  ) {}

  async execute(input: ListBackupsInput): Promise<ListBackupsOutput> {
    if (this.saveFileIndexRepository) {
      const saves = await this.saveFileIndexRepository.listByUserAndGame(input.userId, input.gameId);
      const backupSaves = saves.filter((s) => s.filename.startsWith("backups/"));
      if (backupSaves.length > 0) {
        const backups: BackupMetadata[] = backupSaves.map((s) => {
          const prefix = `${input.userId}/${input.gameId}/backups/`;
          const filename = s.key.startsWith(prefix) ? s.key.slice(prefix.length) : s.filename.replace(/^backups\//, "");
          return {
            key: s.key,
            lastModified: s.lastModified ?? new Date(0),
            size: s.size,
            filename: filename || s.filename,
          };
        });
        return { backups };
      }
    }

    const backups = await this.saveRepository.listBackups(input.userId, input.gameId);
    return { backups };
  }
}
