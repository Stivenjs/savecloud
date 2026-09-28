import type { FastifyInstance, FastifyReply } from "fastify";
import type { CreateShareLinkUseCase } from "@application/use-cases/CreateShareLinkUseCase";
import type { GetSharedGameUseCase } from "@application/use-cases/GetSharedGameUseCase";
import { getUserId } from "@interfaces/http/helpers/request-context";
import { ApplicationError } from "@application/errors/ApplicationError";
import { getPublicBaseUrl } from "@interfaces/http/helpers/public-base-url";

export async function registerShareRoutes(
  app: FastifyInstance,
  deps: { createShareLinkUseCase: CreateShareLinkUseCase; getSharedGameUseCase: GetSharedGameUseCase }
): Promise<void> {
  app.post<{
    Body: { gameId?: string; expiresInDays?: number };
  }>("/share", async (request, reply: FastifyReply) => {
    const userId = getUserId(request);
    const { gameId, expiresInDays } = request.body ?? {};

    if (!gameId?.trim()) {
      throw new ApplicationError("INVALID_ARGUMENT", "El identificador del juego es obligatorio.");
    }

    const { token, expiresAt } = await deps.createShareLinkUseCase.execute({
      userId,
      gameId: gameId.trim(),
      expiresInDays,
    });
    const shareUrl = `${getPublicBaseUrl(request)}/share/${token}`;

    return reply.status(201).send({ token, shareUrl, expiresAt });
  });

  app.get<{ Params: { token: string } }>(
    "/share/:token",
    {
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
    },
    async (request, reply: FastifyReply) => {
      const { token } = request.params;
      const result = await deps.getSharedGameUseCase.execute(token);

      switch (result.status) {
        case "ok": {
          if (result.filesError) {
            request.log.warn({ err: result.filesError }, "No se pudieron consultar los archivos del enlace compartido");
          }
          return reply.send({
            userId: result.payload.userId,
            gameId: result.payload.gameId,
            expiresAt: result.payload.expiresAt,
            files: result.files,
            isPackaged: result.isPackaged,
          });
        }

        case "expired":
          throw new ApplicationError("GONE", "Este enlace ha expirado.");

        case "not_found":
          throw new ApplicationError("NOT_FOUND", "El enlace no es válido.");

        case "error":
          throw new ApplicationError("UPSTREAM_FAILURE", "No se pudo verificar el enlace. Inténtalo de nuevo.");
      }
    }
  );
}
