import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { CreateShareLinkUseCase } from "@application/use-cases/CreateShareLinkUseCase";
import type { GetSharedGameUseCase } from "@application/use-cases/GetSharedGameUseCase";

const USER_ID_HEADER = "x-user-id";

function getUserId(request: FastifyRequest): string {
  const userId = request.headers[USER_ID_HEADER];
  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("Missing or invalid x-user-id header");
  }
  return userId.trim();
}

function getBaseUrl(request: FastifyRequest): string {
  const env = process.env.SHARE_BASE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  const proto = (request.headers["x-forwarded-proto"] as string) || "https";
  const host = request.headers["x-forwarded-host"] ?? request.headers.host ?? "";
  return `${proto}://${host}`;
}

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
      return reply.status(400).send({ error: "Bad Request", message: "gameId is required" });
    }

    const { token, expiresAt } = await deps.createShareLinkUseCase.execute({
      userId,
      gameId: gameId.trim(),
      expiresInDays,
    });
    const shareUrl = `${getBaseUrl(request)}/share/${token}`;

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
          return reply.status(410).send({
            error: "Gone",
            message: "Este enlace ha expirado",
          });

        case "not_found":
          return reply.status(404).send({
            error: "Not Found",
            message: "Enlace inválido",
          });

        case "error":
          return reply.status(502).send({
            error: "Bad Gateway",
            message: "No se pudo verificar el enlace, intenta de nuevo",
          });
      }
    }
  );
}
