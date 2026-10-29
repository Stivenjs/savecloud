import type { SaveRepository, UploadUrlItem, UploadUrlResult } from "@domain/ports/SaveRepository";
import { assertSafeSavePath } from "@application/helpers/savePathValidator";

export interface GetUploadUrlsInput {
  userId: string;
  items: UploadUrlItem[];
}

export interface GetUploadUrlsOutput {
  urls: UploadUrlResult[];
}

/**
 * Caso de uso: obtener varias URLs firmadas de subida en una sola llamada.
 * Valida que cada archivo y juego cumpla las reglas de seguridad de rutas.
 */
export class GetUploadUrlsUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: GetUploadUrlsInput): Promise<GetUploadUrlsOutput> {
    for (const item of input.items) {
      assertSafeSavePath(item.gameId, item.filename);
    }

    const urls = await this.saveRepository.getUploadUrls(input.userId, input.items);
    return { urls };
  }
}
