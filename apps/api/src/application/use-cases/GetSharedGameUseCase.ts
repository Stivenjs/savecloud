import type { ShareTokenRepository } from "@domain/ports/ShareTokenRepository";
import type { SaveRepository } from "@domain/ports/SaveRepository";

export class GetSharedGameUseCase {
  constructor(
    private readonly shareTokenRepository: ShareTokenRepository,
    private readonly saveRepository: SaveRepository
  ) {}

  async execute(token: string) {
    const tokenResult = await this.shareTokenRepository.getToken(token);
    if (tokenResult.status !== "ok") return tokenResult;

    let files: { filename: string; size?: number; key: string }[] = [];
    let isPackaged = false;
    let filesError: unknown;
    try {
      const saves = await this.saveRepository.listByUserAndGame(tokenResult.payload.userId, tokenResult.payload.gameId);
      files = saves.map(({ filename, size, key }) => ({ filename, size, key }));
      isPackaged = files.some((file) => file.filename.startsWith("backups/") || file.filename.endsWith(".tar"));
    } catch (error) {
      // El enlace sigue siendo válido aunque la lista complementaria de archivos no esté disponible.
      filesError = error;
    }

    return {
      status: "ok" as const,
      payload: tokenResult.payload,
      files,
      isPackaged,
      filesError,
    };
  }
}
