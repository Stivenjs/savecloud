import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import type { SaveRepository } from "@domain/ports/SaveRepository";
import type { ShareTokenS3 } from "@infrastructure/share/ShareTokenS3";
import { GetUploadUrlUseCase } from "@application/use-cases/GetUploadUrlUseCase";
import { GetUploadUrlsUseCase } from "@application/use-cases/GetUploadUrlsUseCase";
import { GetDownloadUrlUseCase } from "@application/use-cases/GetDownloadUrlUseCase";
import { GetDownloadUrlsUseCase } from "@application/use-cases/GetDownloadUrlsUseCase";
import { DeleteGameFromCloudUseCase } from "@application/use-cases/DeleteGameFromCloudUseCase";
import { RenameGameInCloudUseCase } from "@application/use-cases/RenameGameInCloudUseCase";
import { ListBackupsUseCase } from "@application/use-cases/ListBackupsUseCase";
import { DeleteBackupUseCase } from "@application/use-cases/DeleteBackupUseCase";
import { RenameBackupUseCase } from "@application/use-cases/RenameBackupUseCase";
import { ListSavesUseCase } from "@application/use-cases/ListSavesUseCase";
import { CreateMultipartUploadUseCase } from "@application/use-cases/CreateMultipartUploadUseCase";
import { CreateMultipartUploadWithPartUrlsUseCase } from "@application/use-cases/CreateMultipartUploadWithPartUrlsUseCase";
import { GetUploadPartUrlsUseCase } from "@application/use-cases/GetUploadPartUrlsUseCase";
import { CompleteMultipartUploadUseCase } from "@application/use-cases/CompleteMultipartUploadUseCase";
import { AbortMultipartUploadUseCase } from "@application/use-cases/AbortMultipartUploadUseCase";
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
  const getUploadUrlsUseCase = new GetUploadUrlsUseCase(deps.saveRepository);
  const getDownloadUrlUseCase = new GetDownloadUrlUseCase(deps.saveRepository);
  const getDownloadUrlsUseCase = new GetDownloadUrlsUseCase(
    deps.saveRepository
  );
  const deleteGameFromCloudUseCase = new DeleteGameFromCloudUseCase(
    deps.saveRepository
  );
  const renameGameInCloudUseCase = new RenameGameInCloudUseCase(
    deps.saveRepository
  );
  const listSavesUseCase = new ListSavesUseCase(deps.saveRepository);
  const listBackupsUseCase = new ListBackupsUseCase(deps.saveRepository);
  const deleteBackupUseCase = new DeleteBackupUseCase(deps.saveRepository);
  const renameBackupUseCase = new RenameBackupUseCase(deps.saveRepository);
  const createMultipartUploadUseCase = new CreateMultipartUploadUseCase(
    deps.saveRepository
  );
  const createMultipartUploadWithPartUrlsUseCase =
    new CreateMultipartUploadWithPartUrlsUseCase(deps.saveRepository);
  const getUploadPartUrlsUseCase = new GetUploadPartUrlsUseCase(
    deps.saveRepository
  );
  const completeMultipartUploadUseCase = new CompleteMultipartUploadUseCase(
    deps.saveRepository
  );
  const abortMultipartUploadUseCase = new AbortMultipartUploadUseCase(
    deps.saveRepository
  );

  await registerSavesRoutes(app, {
    getUploadUrlUseCase,
    getUploadUrlsUseCase,
    getDownloadUrlUseCase,
    getDownloadUrlsUseCase,
    deleteGameFromCloudUseCase,
    renameGameInCloudUseCase,
    listSavesUseCase,
    listBackupsUseCase,
    deleteBackupUseCase,
    renameBackupUseCase,
    createMultipartUploadUseCase,
    createMultipartUploadWithPartUrlsUseCase,
    getUploadPartUrlsUseCase,
    completeMultipartUploadUseCase,
    abortMultipartUploadUseCase,
  });

  if (deps.shareTokenStore) {
    await registerShareRoutes(app, deps.shareTokenStore);
  }

  app.get("/health", async (_, reply: FastifyReply) => {
    return reply.send({ status: "ok" });
  });

  return app;
}
