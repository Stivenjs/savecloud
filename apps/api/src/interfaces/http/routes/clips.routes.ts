import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ClipStore } from "@infrastructure/clips/ClipStore";
import { renderNotFoundHtml, renderWatchHtml } from "@interfaces/http/views/clipWatchHtml";

const USER_ID_HEADER = "x-user-id";

/**
 * Extrae y valida el identificador de usuario a partir del encabezado HTTP.
 */
function getUserId(request: FastifyRequest): string {
  const userId = request.headers[USER_ID_HEADER];
  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("Missing or invalid x-user-id header");
  }
  return userId.trim();
}

/**
 * Obtiene la URL base pública para construir enlaces compartibles.
 */
function getBaseUrl(request: FastifyRequest): string {
  const env = process.env.SHARE_BASE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  const proto = (request.headers["x-forwarded-proto"] as string) || "https";
  const host = request.headers["x-forwarded-host"] ?? request.headers.host ?? "";
  return `${proto}://${host}`;
}

/**
 * Registra las rutas HTTP asociadas a los clips de vídeo.
 */
export async function registerClipRoutes(app: FastifyInstance, clipStore: ClipStore): Promise<void> {
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
      return reply.status(400).send({ error: "Bad Request", message: "gameId is required" });
    }
    if (!filename?.trim()) {
      return reply.status(400).send({ error: "Bad Request", message: "filename is required" });
    }

    try {
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

      const baseUrl = getBaseUrl(request);
      const watchUrl = `${baseUrl}/v/${clipId}`;

      return reply.status(201).send({
        clipId,
        uploadUrl,
        cdnUrl,
        watchUrl,
      });
    } catch (err) {
      request.log.error(err, "Failed to create clip upload URL");
      return reply.status(500).send({ error: "Internal Server Error", message: "No se pudo generar la URL de subida" });
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
    const baseUrl = getBaseUrl(request);

    try {
      const clips = await clipStore.listClips(userId, gameId, baseUrl);
      return reply.send({ clips });
    } catch (err) {
      request.log.error(err, "Failed to list clips");
      return reply.status(500).send({ error: "Internal Server Error", message: "Error al listar clips" });
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
      return reply.status(400).send({ error: "Bad Request", message: "clipId is required" });
    }

    try {
      const deleted = await clipStore.deleteUserClip(userId, clipId.trim());
      if (!deleted) {
        return reply.status(404).send({ error: "Not Found", message: "Clip no encontrado o no autorizado" });
      }
      return reply.status(200).send({ ok: true, message: "Clip eliminado correctamente" });
    } catch (err) {
      request.log.error(err, "Failed to delete clip");
      return reply.status(500).send({ error: "Internal Server Error", message: "Error al eliminar clip" });
    }
  });

  /**
   * Manejador común para visualizar el reproductor web del clip.
   */
  const handleWatch = async (request: FastifyRequest<{ Params: { clipId: string } }>, reply: FastifyReply) => {
    const { clipId } = request.params;
    const defaultCoverUrl = clipStore.buildCdnUrl("clips/assets/savecloud-clip-cover.png");
    const result = await clipStore.getClip(clipId);

    if (result.status === "not_found") {
      return reply
        .status(404)
        .header("Cache-Control", "public, max-age=60, s-maxage=300")
        .type("text/html; charset=utf-8")
        .send(renderNotFoundHtml(defaultCoverUrl));
    }

    if (result.status === "error") {
      return reply
        .status(502)
        .header("Cache-Control", "no-cache, no-store, must-revalidate")
        .type("text/html; charset=utf-8")
        .send("<h1>Error al cargar el clip</h1>");
    }

    const baseUrl = getBaseUrl(request);
    const watchUrl = `${baseUrl}/v/${clipId}`;
    const html = renderWatchHtml({
      clip: result.clip,
      cdnUrl: result.cdnUrl,
      watchUrl,
      defaultCoverUrl,
    });

    return reply
      .status(200)
      .header("Cache-Control", "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800")
      .type("text/html; charset=utf-8")
      .send(html);
  };

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
    handleWatch
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
    handleWatch
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
        return reply.status(404).send({ error: "Not Found", message: "Clip no encontrado" });
      }
      if (result.status === "error") {
        return reply.status(502).send({ error: "Bad Gateway", message: "Error al consultar el clip" });
      }

      const baseUrl = getBaseUrl(request);
      return reply.header("Cache-Control", "public, max-age=120, s-maxage=3600, stale-while-revalidate=86400").send({
        clip: result.clip,
        cdnUrl: result.cdnUrl,
        watchUrl: `${baseUrl}/v/${clipId}`,
      });
    }
  );
}
