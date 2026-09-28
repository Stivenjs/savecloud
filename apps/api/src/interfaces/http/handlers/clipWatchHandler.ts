import type { FastifyReply, FastifyRequest } from "fastify";
import type { ClipRepository } from "@domain/ports/ClipRepository";
import { renderNotFoundHtml, renderWatchHtml } from "@interfaces/http/views/clipWatchHtml";
import { getPublicBaseUrl } from "@interfaces/http/helpers/public-base-url";

export function createClipWatchHandler(clipRepository: ClipRepository) {
  return async (request: FastifyRequest<{ Params: { clipId: string } }>, reply: FastifyReply) => {
    const { clipId } = request.params;
    const defaultCoverUrl = clipRepository.buildCdnUrl("clips/assets/savecloud-clip-cover.png");
    const result = await clipRepository.getClip(clipId);

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

    const baseUrl = getPublicBaseUrl(request);
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
}
