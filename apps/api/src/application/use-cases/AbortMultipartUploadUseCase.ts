import type { SaveRepository } from "@domain/ports/SaveRepository";

export interface AbortMultipartUploadInput {
  key: string;
  uploadId: string;
}

/**
 * Caso de uso: cancelar una subida multipart y liberar recursos en S3.
 */
export class AbortMultipartUploadUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: AbortMultipartUploadInput): Promise<void> {
    await this.saveRepository.abortMultipartUpload(input.key, input.uploadId);
  }
}
