import type { SaveRepository } from "@domain/ports/SaveRepository";
import type { UploadPartUrl } from "@domain/ports/SaveRepository";

export interface GetUploadPartUrlsInput {
  key: string;
  uploadId: string;
  partNumbers: number[];
}

export interface GetUploadPartUrlsOutput {
  partUrls: UploadPartUrl[];
}

/**
 * Caso de uso: obtener URLs firmadas para subir cada parte de una subida multipart.
 * partNumbers son 1-based. El cliente hace PUT del cuerpo de la parte a cada URL.
 */
export class GetUploadPartUrlsUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: GetUploadPartUrlsInput): Promise<GetUploadPartUrlsOutput> {
    const partUrls = await this.saveRepository.getUploadPartUrls(input.key, input.uploadId, input.partNumbers);
    return { partUrls };
  }
}
