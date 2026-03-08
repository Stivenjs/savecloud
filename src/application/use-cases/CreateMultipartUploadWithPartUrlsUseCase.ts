import type { SaveRepository } from "@domain/ports/SaveRepository";

export const MAX_PARTS_INIT_WITH_URLS = 2000;

export interface CreateMultipartUploadWithPartUrlsInput {
  userId: string;
  gameId: string;
  filename: string;
  partCount: number;
}

export interface CreateMultipartUploadWithPartUrlsOutput {
  uploadId: string;
  key: string;
  partUrls: { partNumber: number; url: string }[];
}

/**
 * Inicia multipart y devuelve todas las URLs de partes en una sola invocación (menos Lambda).
 * partCount se limita a MAX_PARTS_INIT_WITH_URLS para evitar timeouts/respuestas enormes.
 */
export class CreateMultipartUploadWithPartUrlsUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(
    input: CreateMultipartUploadWithPartUrlsInput
  ): Promise<CreateMultipartUploadWithPartUrlsOutput> {
    const partCount = Math.min(
      Math.max(1, Math.floor(input.partCount)),
      MAX_PARTS_INIT_WITH_URLS
    );
    return this.saveRepository.createMultipartUploadWithPartUrls(
      input.userId,
      input.gameId,
      input.filename,
      partCount
    );
  }
}
