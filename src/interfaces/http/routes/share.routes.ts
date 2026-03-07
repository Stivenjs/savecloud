import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ShareTokenS3 } from "@infrastructure/share/ShareTokenS3";

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
  const host =
    request.headers["x-forwarded-host"] ?? request.headers.host ?? "";
  return `${proto}://${host}`;
}

export async function registerShareRoutes(
  app: FastifyInstance,
  shareTokenStore: ShareTokenS3
): Promise<void> {
  app.post<{
    Body: { gameId?: string; expiresInDays?: number };
  }>("/share", async (request, reply: FastifyReply) => {
    const userId = getUserId(request);
    const { gameId, expiresInDays } = request.body ?? {};
    if (!gameId?.trim()) {
      return reply.status(400).send({
        error: "Bad Request",
        message: "gameId is required",
      });
    }
    const ttlSeconds =
      typeof expiresInDays === "number" && expiresInDays > 0
        ? Math.min(expiresInDays * 24 * 60 * 60, 365 * 24 * 60 * 60)
        : 7 * 24 * 60 * 60;
    const { token } = await shareTokenStore.createToken(
      userId,
      gameId.trim(),
      ttlSeconds
    );
    const baseUrl = getBaseUrl(request);
    const shareUrl = `${baseUrl}/share/${token}`;
    return reply.send({ token, shareUrl });
  });

  app.get<{ Params: { token: string } }>(
    "/share/:token",
    async (request, reply: FastifyReply) => {
      const { token } = request.params;
      const payload = await shareTokenStore.getToken(token);
      if (!payload) {
        return reply.status(404).send({
          error: "Not Found",
          message: "Link inválido o expirado",
        });
      }
      return reply.send({
        userId: payload.userId,
        gameId: payload.gameId,
      });
    }
  );
}
