import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ShareTokenS3 } from "@infrastructure/share/ShareTokenS3";
import type { DynamoDbShareTokenStore } from "@infrastructure/share/DynamoDbShareTokenStore";
import type { SaveRepository } from "@domain/ports/SaveRepository";

const USER_ID_HEADER = "x-user-id";
const MAX_TTL_SECONDS = 365 * 24 * 60 * 60;
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

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

function resolveTtlSeconds(expiresInDays: unknown): number {
  if (typeof expiresInDays === "number" && expiresInDays > 0) {
    return Math.min(Math.floor(expiresInDays * 24 * 60 * 60), MAX_TTL_SECONDS);
  }
  return DEFAULT_TTL_SECONDS;
}

export async function registerShareRoutes(
  app: FastifyInstance,
  shareTokenStore: ShareTokenS3 | DynamoDbShareTokenStore,
  saveRepository?: SaveRepository
): Promise<void> {
  app.post<{
    Body: { gameId?: string; expiresInDays?: number };
  }>("/share", async (request, reply: FastifyReply) => {
    const userId = getUserId(request);
    const { gameId, expiresInDays } = request.body ?? {};

    if (!gameId?.trim()) {
      return reply.status(400).send({ error: "Bad Request", message: "gameId is required" });
    }

    const ttlSeconds = resolveTtlSeconds(expiresInDays);
    const { token, expiresAt } = await shareTokenStore.createToken(userId, gameId.trim(), ttlSeconds);
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
      const result = await shareTokenStore.getToken(token);

      switch (result.status) {
        case "ok": {
          let files: { filename: string; size?: number; key: string }[] = [];
          let isPackaged = false;

          if (saveRepository) {
            try {
              const saves = await saveRepository.listByUserAndGame(result.payload.userId, result.payload.gameId);
              files = saves.map((s) => ({
                filename: s.filename,
                size: s.size,
                key: s.key,
              }));
              isPackaged = files.some((f) => f.filename.startsWith("backups/") || f.filename.endsWith(".tar"));
            } catch (err) {
              request.log.warn({ err }, "Could not resolve save files for share token");
            }
          }

          return reply.send({
            userId: result.payload.userId,
            gameId: result.payload.gameId,
            expiresAt: result.payload.expiresAt,
            files,
            isPackaged,
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
