import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import type { SaveRepository } from "@domain/ports/SaveRepository";
import type { ShareTokenS3 } from "@infrastructure/share/ShareTokenS3";
import { GetUploadUrlUseCase } from "@application/use-cases/GetUploadUrlUseCase";
import { GetDownloadUrlUseCase } from "@application/use-cases/GetDownloadUrlUseCase";
import { ListSavesUseCase } from "@application/use-cases/ListSavesUseCase";
import { registerSavesRoutes } from "@interfaces/http/routes/saves.routes";
import { registerShareRoutes } from "@interfaces/http/routes/share.routes";

export interface AppDependencies {
  saveRepository: SaveRepository;
  shareTokenStore?: ShareTokenS3;
}

/**
 * Crea y configura la aplicación Fastify con las rutas y casos de uso.
 * Inyección de dependencias en el punto de entrada (composition root).
 */
export async function buildApp(
  deps: AppDependencies
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  const expectedApiKey = process.env.API_KEY;

  if (expectedApiKey) {
    app.addHook("onRequest", async (request, reply) => {
      if (request.url === "/health") return;
      if (request.method === "GET" && request.url.startsWith("/share/")) return;

      const key = request.headers["x-api-key"];
      if (key !== expectedApiKey) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
    });
  }

  const getUploadUrlUseCase = new GetUploadUrlUseCase(deps.saveRepository);
  const getDownloadUrlUseCase = new GetDownloadUrlUseCase(deps.saveRepository);
  const listSavesUseCase = new ListSavesUseCase(deps.saveRepository);

  await registerSavesRoutes(app, {
    getUploadUrlUseCase,
    getDownloadUrlUseCase,
    listSavesUseCase,
  });

  if (deps.shareTokenStore) {
    await registerShareRoutes(app, deps.shareTokenStore);
  }

  app.get("/health", async (_, reply: FastifyReply) => {
    return reply.send({ status: "ok" });
  });

  return app;
}
