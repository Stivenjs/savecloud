import type { SaveRepository } from "@domain/ports/SaveRepository";
import { ApplicationError } from "@application/errors/ApplicationError";

export interface GetDownloadUrlInput {
  userId: string;
  gameId: string;
  key: string;
  /** Rango opcional en bytes para descarga resumible (pausar/reanudar por chunk). */
  range?: { start: number; end: number };
}

export interface GetDownloadUrlOutput {
  downloadUrl: string;
  key: string;
}

/**
 * Caso de uso: obtener URL firmada para descargar un guardado desde S3.
 * La key debe pertenecer al usuario (prefijo userId/gameId/).
 * Si se pasa range, la URL solo sirve para ese rango (útil para descarga por partes y pausar/reanudar).
 */
export class GetDownloadUrlUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: GetDownloadUrlInput): Promise<GetDownloadUrlOutput> {
    const expectedPrefix = `${input.userId}/${input.gameId}/`;
    if (!input.key.startsWith(expectedPrefix) || input.key.includes("..")) {
      throw new ApplicationError("INVALID_ARGUMENT", "La clave debe pertenecer al usuario y juego solicitados.");
    }
    const downloadUrl = await this.saveRepository.getDownloadUrl(input.userId, input.gameId, input.key, input.range);
    return { downloadUrl, key: input.key };
  }
}
