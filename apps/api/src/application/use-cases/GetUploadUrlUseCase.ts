import type { SaveRepository } from "@domain/ports/SaveRepository";

export interface GetUploadUrlInput {
  userId: string;
  gameId: string;
  filename: string;
}

export interface GetUploadUrlOutput {
  uploadUrl: string;
  key: string;
}

/**
 * Caso de uso: obtener URL firmada para subir un guardado a S3.
 * Solo orquesta el puerto; no conoce S3 ni HTTP.
 */
export class GetUploadUrlUseCase {
  constructor(private readonly saveRepository: SaveRepository) {}

  async execute(input: GetUploadUrlInput): Promise<GetUploadUrlOutput> {
    const uploadUrl = await this.saveRepository.getUploadUrl(input.userId, input.gameId, input.filename);
    const key = `${input.userId}/${input.gameId}/${input.filename}`;
    return { uploadUrl, key };
  }
}
