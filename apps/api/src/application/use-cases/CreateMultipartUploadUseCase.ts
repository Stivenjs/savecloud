import type { SaveRepository } from "@domain/ports/SaveRepository";

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
 * Devuelve uploadId y key para solicitar URLs de partes y luego completar o abortar.
 */
export class CreateMultipartUploadUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: CreateMultipartUploadInput): Promise<CreateMultipartUploadOutput> {
    return this.saveRepository.createMultipartUpload(input.userId, input.gameId, input.filename);
  }
}
