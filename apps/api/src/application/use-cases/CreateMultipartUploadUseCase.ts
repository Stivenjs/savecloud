import type { SaveRepository } from "@domain/ports/SaveRepository";
import { assertSafeSavePath } from "@application/helpers/savePathValidator";

export interface CreateMultipartUploadInput {
  userId: string;
  gameId: string;
  filename: string;
}

export interface CreateMultipartUploadOutput {
  uploadId: string;
  key: string;
}

/**
 * Caso de uso: iniciar una subida multipart (archivos grandes).
 * Valida que los identificadores de juego y archivo sean seguros.
 */
export class CreateMultipartUploadUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: CreateMultipartUploadInput): Promise<CreateMultipartUploadOutput> {
    assertSafeSavePath(input.gameId, input.filename);
    return this.saveRepository.createMultipartUpload(input.userId, input.gameId, input.filename);
  }
}
