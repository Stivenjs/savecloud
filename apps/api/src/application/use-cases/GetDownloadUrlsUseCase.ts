import type { DownloadUrlItem, DownloadUrlResult, SaveRepository } from "@domain/ports/SaveRepository";
import { assertSafeKeyPrefix } from "@application/helpers/savePathValidator";

export interface GetDownloadUrlsInput {
  userId: string;
  items: DownloadUrlItem[];
}

export interface GetDownloadUrlsOutput {
  urls: DownloadUrlResult[];
}

/**
 * Caso de uso: obtener varias URLs firmadas de descarga en una sola llamada.
 * Valida que cada clave pertenezca al usuario y juego especificados antes de firmar.
 */
export class GetDownloadUrlsUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: GetDownloadUrlsInput): Promise<GetDownloadUrlsOutput> {
    for (const item of input.items) {
      assertSafeKeyPrefix(input.userId, item.gameId, item.key);
    }

    const urls = await this.saveRepository.getDownloadUrls(input.userId, input.items);
    return { urls };
  }
}
