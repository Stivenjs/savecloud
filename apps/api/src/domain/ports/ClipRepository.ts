import type { ClipDto, GetClipResult } from "@domain/entities/Clip";

/** Define las operaciones de persistencia y consulta del dominio de clips. */
export interface ClipRepository {
  buildCdnUrl(key: string): string;
  createClipUploadUrl(
    userId: string,
    gameId: string,
    filename: string,
    contentTypeOverride?: string,
    options?: { posterUrl?: string; steamAppId?: string; gameTitle?: string; thumbnailBase64?: string }
  ): Promise<{ clipId: string; uploadUrl: string; cdnUrl: string; videoKey: string }>;
  getClip(clipId: string): Promise<GetClipResult>;
  listClips(userId: string, gameId?: string, baseUrl?: string): Promise<ClipDto[]>;
  deleteUserClip(userId: string, clipId: string): Promise<boolean>;
}
