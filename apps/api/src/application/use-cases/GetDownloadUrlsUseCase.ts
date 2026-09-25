import type { DownloadUrlItem, DownloadUrlResult, SaveRepository } from "@domain/ports/SaveRepository";

export interface GetDownloadUrlsInput {
  userId: string;
  items: DownloadUrlItem[];
}

export interface GetDownloadUrlsOutput {
  urls: DownloadUrlResult[];
}

/**
 * Caso de uso: obtener varias URLs firmadas de descarga en una sola llamada.
 * Reduce round-trips y una única invocación Lambda para muchos archivos.
 */
export class GetDownloadUrlsUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: GetDownloadUrlsInput): Promise<GetDownloadUrlsOutput> {
    const urls = await this.saveRepository.getDownloadUrls(input.userId, input.items);
    return { urls };
  }
}
