import type { SaveRepository } from "@domain/ports/SaveRepository";
import { assertSafeSavePath } from "@application/helpers/savePathValidator";

export interface GetUploadUrlInput {
  userId: string;
  gameId: string;
  filename: string;
}

export interface GetUploadUrlOutput {
  uploadUrl: string;
  key: string;
}

/**
 * Caso de uso: obtener URL firmada para subir un guardado a S3.
 * Valida que el nombre de archivo y el juego no contengan secuencias de escape.
 */
export class GetUploadUrlUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: GetUploadUrlInput): Promise<GetUploadUrlOutput> {
    assertSafeSavePath(input.gameId, input.filename);
    const uploadUrl = await this.saveRepository.getUploadUrl(input.userId, input.gameId, input.filename);
    const key = `${input.userId}/${input.gameId}/${input.filename}`;
    return { uploadUrl, key };
  }
}
