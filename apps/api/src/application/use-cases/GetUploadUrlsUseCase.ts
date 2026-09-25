import type { SaveRepository, UploadUrlItem, UploadUrlResult } from "@domain/ports/SaveRepository";

export interface GetUploadUrlsInput {
  userId: string;
  items: UploadUrlItem[];
}

export interface GetUploadUrlsOutput {
  urls: UploadUrlResult[];
}

/**
 * Caso de uso: obtener varias URLs firmadas de subida en una sola llamada.
 * Reduce round-trips y una única invocación Lambda para muchos archivos.
 */
export class GetUploadUrlsUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: GetUploadUrlsInput): Promise<GetUploadUrlsOutput> {
    const urls = await this.saveRepository.getUploadUrls(input.userId, input.items);
    return { urls };
  }
}
