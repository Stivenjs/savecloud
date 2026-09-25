import type { SaveRepository } from "@domain/ports/SaveRepository";
import type { CompletedPart } from "@domain/ports/SaveRepository";

export interface CompleteMultipartUploadInput {
  key: string;
  uploadId: string;
  parts: CompletedPart[];
}

/**
 * Caso de uso: completar una subida multipart con los ETags de cada parte.
 * S3 devuelve el ETag en el header de la respuesta al hacer PUT de cada parte.
 */
export class CompleteMultipartUploadUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: CompleteMultipartUploadInput): Promise<void> {
    await this.saveRepository.completeMultipartUpload(input.key, input.uploadId, input.parts);
  }
}
