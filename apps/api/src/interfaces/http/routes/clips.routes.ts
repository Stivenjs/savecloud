import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ClipRepository } from "@domain/ports/ClipRepository";
import { getUserId } from "@interfaces/http/helpers/request-context";
import { ApplicationError } from "@application/errors/ApplicationError";
import { getPublicBaseUrl } from "@interfaces/http/helpers/public-base-url";
import { createClipWatchHandler } from "@interfaces/http/handlers/clipWatchHandler";

/**
 * Registra las rutas HTTP asociadas a los clips de vídeo.
 */
export async function registerClipRoutes(app: FastifyInstance, clipStore: ClipRepository): Promise<void> {
  /**
   * POST /clips/upload-url (Autenticado)
   * Solicita una URL presignada para subir el archivo binario del clip directamente a S3.
   */
  app.post<{
    Body: {
      gameId?: string;
      filename?: string;
      contentType?: string;
    };
  }>("/clips/upload-url", async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const { gameId, filename, contentType, posterUrl, steamAppId, gameTitle, thumbnailBase64 } =
      (request.body as {
        gameId?: string;
        filename?: string;
        contentType?: string;
        posterUrl?: string;
        steamAppId?: string;
        gameTitle?: string;
        thumbnailBase64?: string;
      }) ?? {};

    if (!gameId?.trim()) {
      throw new ApplicationError("INVALID_ARGUMENT", "El identificador del juego es obligatorio.");
    }
    if (!filename?.trim()) {
      throw new ApplicationError("INVALID_ARGUMENT", "El nombre del archivo es obligatorio.");
    }

    {
      const { clipId, uploadUrl, cdnUrl } = await clipStore.createClipUploadUrl(
        userId,
        gameId.trim(),
        filename.trim(),
        contentType,
        {
          posterUrl,
          steamAppId,
          gameTitle,
          thumbnailBase64,
        }
      );

      const baseUrl = getPublicBaseUrl(request);
      const watchUrl = `${baseUrl}/v/${clipId}`;

      return reply.status(201).send({
        clipId,
        uploadUrl,
        cdnUrl,
        watchUrl,
      });
    }
  });

  /**
   * GET /clips (Autenticado)
   * Lista todos los clips del usuario autenticado, opcionalmente filtrados por ?gameId=...
   */
  app.get<{
    Querystring: {
      gameId?: string;
    };
  }>("/clips", async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const { gameId } = (request.query as { gameId?: string }) ?? {};
    const baseUrl = getPublicBaseUrl(request);

    {
      const clips = await clipStore.listClips(userId, gameId, baseUrl);
      return reply.send({ clips });
    }
  });

  /**
   * DELETE /clips/:clipId (Autenticado)
   * Elimina un clip específico del usuario autenticado.
   */
  app.delete<{
    Params: {
      clipId: string;
    };
  }>("/clips/:clipId", async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(request);
    const { clipId } = request.params as { clipId: string };

    if (!clipId?.trim()) {
      throw new ApplicationError("INVALID_ARGUMENT", "El identificador del clip es obligatorio.");
    }

    {
      const deleted = await clipStore.deleteUserClip(userId, clipId.trim());
      if (!deleted) {
        throw new ApplicationError("NOT_FOUND", "No se encontró el clip solicitado.");
      }
      return reply.status(200).send({ ok: true, message: "Clip eliminado correctamente" });
    }
  });

  const watchHandler = createClipWatchHandler(clipStore);

  /**
   * GET /v/:clipId (PÚBLICO)
   * Renderiza el reproductor web optimizado con streaming por CDN.
   */
  app.get<{ Params: { clipId: string } }>(
    "/v/:clipId",
    {
      config: {
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    watchHandler
  );

  /**
   * GET /clip/:clipId (PÚBLICO)
   * Alias de visualización.
   */
  app.get<{ Params: { clipId: string } }>(
    "/clip/:clipId",
    {
      config: {
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    watchHandler
  );

  /**
   * GET /api/clips/:clipId (PÚBLICO)
   * Devuelve información JSON del clip y su URL CDN.
   */
  app.get<{ Params: { clipId: string } }>(
    "/api/clips/:clipId",
    {
      config: {
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    async (request, reply: FastifyReply) => {
      const { clipId } = request.params;
      const result = await clipStore.getClip(clipId);

      if (result.status === "not_found") {
        throw new ApplicationError("NOT_FOUND", "Clip no encontrado.");
      }
      if (result.status === "error") {
        throw new ApplicationError("UPSTREAM_FAILURE", "No se pudo consultar el clip.");
      }

      const baseUrl = getPublicBaseUrl(request);
      return reply.header("Cache-Control", "public, max-age=120, s-maxage=3600, stale-while-revalidate=86400").send({
        clip: result.clip,
        cdnUrl: result.cdnUrl,
        watchUrl: `${baseUrl}/v/${clipId}`,
      });
    }
  );
}
