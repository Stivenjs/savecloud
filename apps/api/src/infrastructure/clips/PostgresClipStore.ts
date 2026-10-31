import type { SQL } from "bun";
import type { S3Client } from "@aws-sdk/client-s3";
import type { ClipDto, ClipMetadata, GetClipResult } from "@domain/entities/Clip";
import { ClipStore } from "./ClipStore";

interface ClipRow {
  clip_id: string;
  user_id: string;
  game_id: string;
  filename: string;
  video_key: string;
  content_type: string;
  created_at: string;
  poster_url: string | null;
  steam_app_id: string | null;
  game_title: string | null;
}

/** Almacena el índice de metadatos de clips en PostgreSQL y conserva los archivos en S3. */
export class PostgresClipStore extends ClipStore {
  constructor(
    s3: S3Client,
    bucketName: string,
    private readonly sql: SQL,
    presignS3?: S3Client
  ) {
    super(s3, bucketName, presignS3);
  }

  /** Crea la URL de carga y registra en PostgreSQL los metadatos que deja el adaptador S3. */
  override async createClipUploadUrl(
    userId: string,
    gameId: string,
    filename: string,
    contentTypeOverride?: string,
    options?: { posterUrl?: string; steamAppId?: string; gameTitle?: string; thumbnailBase64?: string }
  ): Promise<{ clipId: string; uploadUrl: string; cdnUrl: string; videoKey: string }> {
    const result = await super.createClipUploadUrl(userId, gameId, filename, contentTypeOverride, options);
    const clip = await super.getClip(result.clipId);
    if (clip.status === "ok") await this.saveMetadata(clip.clip);
    return result;
  }

  /** Busca primero en PostgreSQL y usa los metadatos S3 heredados si no hay fila. */
  override async getClip(clipId: string): Promise<GetClipResult> {
    if (!clipId?.trim()) return { status: "not_found" };
    try {
      const rows = await this.sql<ClipRow[]>`
        SELECT clip_id, user_id, game_id, filename, video_key, content_type, created_at, poster_url, steam_app_id, game_title
        FROM savecloud_clips WHERE clip_id = ${clipId.trim()} LIMIT 1
      `;
      if (rows[0]) {
        const clip = mapClip(rows[0]);
        return { status: "ok", clip, cdnUrl: this.buildCdnUrl(clip.videoKey) };
      }

      const fallback = await super.getClip(clipId);
      if (fallback.status === "ok") await this.saveMetadata(fallback.clip);
      return fallback;
    } catch (cause: unknown) {
      console.error("[PostgresClipStore] Error al obtener clip", { clipId, cause });
      return { status: "error", cause };
    }
  }

  /** Lista los clips de un usuario y, si corresponde, limita el resultado a un juego. */
  override async listClips(userId: string, gameId?: string, baseUrl = ""): Promise<ClipDto[]> {
    if (!userId?.trim()) return [];
    try {
      const normalizedUserId = userId.trim();
      const normalizedGameId = gameId?.trim() || null;
      const rows = await this.sql<ClipRow[]>`
        SELECT clip_id, user_id, game_id, filename, video_key, content_type, created_at, poster_url, steam_app_id, game_title
        FROM savecloud_clips
        WHERE user_id = ${normalizedUserId} AND (${normalizedGameId}::text IS NULL OR game_id = ${normalizedGameId})
        ORDER BY created_at DESC
      `;
      if (rows.length > 0) return rows.map((row) => mapClipDto(mapClip(row), baseUrl, this.buildCdnUrl.bind(this)));

      const fallback = await super.listClips(normalizedUserId, normalizedGameId ?? undefined, baseUrl);
      await Promise.all(fallback.map((clip) => this.saveMetadata(clip)));
      return fallback;
    } catch (cause: unknown) {
      console.error("[PostgresClipStore] Error al listar clips", { userId, gameId, cause });
      return [];
    }
  }

  /** Elimina el clip y su registro indexado cuando pertenece al usuario indicado. */
  override async deleteUserClip(userId: string, clipId: string): Promise<boolean> {
    const deletedFromS3 = await super.deleteUserClip(userId, clipId);
    if (!deletedFromS3) return false;
    await this.sql`DELETE FROM savecloud_clips WHERE clip_id = ${clipId.trim()}`;
    return true;
  }

  /** Inserta o reemplaza metadatos de un clip en PostgreSQL. */
  private async saveMetadata(clip: ClipMetadata): Promise<void> {
    await this.sql`
      INSERT INTO savecloud_clips
        (clip_id, user_id, game_id, filename, video_key, content_type, created_at, poster_url, steam_app_id, game_title)
      VALUES
        (${clip.clipId}, ${clip.userId}, ${clip.gameId}, ${clip.filename}, ${clip.videoKey}, ${clip.contentType}, ${clip.createdAt}, ${clip.posterUrl ?? null}, ${clip.steamAppId ?? null}, ${clip.gameTitle ?? null})
      ON CONFLICT (clip_id) DO UPDATE SET
        user_id = EXCLUDED.user_id, game_id = EXCLUDED.game_id, filename = EXCLUDED.filename,
        video_key = EXCLUDED.video_key, content_type = EXCLUDED.content_type, created_at = EXCLUDED.created_at,
        poster_url = EXCLUDED.poster_url, steam_app_id = EXCLUDED.steam_app_id, game_title = EXCLUDED.game_title
    `;
  }
}

/** Crea la tabla e índices de búsqueda y orden de clips. */
export async function ensurePostgresClipSchema(sql: SQL): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS savecloud_clips (
      clip_id text PRIMARY KEY,
      user_id text NOT NULL,
      game_id text NOT NULL,
      filename text NOT NULL,
      video_key text NOT NULL,
      content_type text NOT NULL,
      created_at text NOT NULL,
      poster_url text,
      steam_app_id text,
      game_title text
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS savecloud_clips_user_created_idx ON savecloud_clips (user_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS savecloud_clips_user_game_created_idx ON savecloud_clips (user_id, game_id, created_at DESC)`;
}

/** Convierte una fila de PostgreSQL en metadatos de clip. */
function mapClip(row: ClipRow): ClipMetadata {
  return {
    clipId: row.clip_id,
    userId: row.user_id,
    gameId: row.game_id,
    filename: row.filename,
    videoKey: row.video_key,
    contentType: row.content_type,
    createdAt: row.created_at,
    ...(row.poster_url ? { posterUrl: row.poster_url } : {}),
    ...(row.steam_app_id ? { steamAppId: row.steam_app_id } : {}),
    ...(row.game_title ? { gameTitle: row.game_title } : {}),
  };
}

/** Agrega las URLs públicas que la API devuelve para cada clip. */
function mapClipDto(clip: ClipMetadata, baseUrl: string, buildCdnUrl: (key: string) => string): ClipDto {
  return {
    ...clip,
    cdnUrl: buildCdnUrl(clip.videoKey),
    watchUrl: baseUrl ? `${baseUrl}/v/${clip.clipId}` : `/v/${clip.clipId}`,
  };
}
