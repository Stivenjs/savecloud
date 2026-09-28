import type { FastifyInstance } from "fastify";
import type { SaveRepository } from "@domain/ports/SaveRepository";
import type { ShareTokenRepository } from "@domain/ports/ShareTokenRepository";
import { CreateShareLinkUseCase } from "@application/use-cases/CreateShareLinkUseCase";
import { GetSharedGameUseCase } from "@application/use-cases/GetSharedGameUseCase";
import { registerShareRoutes } from "@interfaces/http/routes/share.routes";

export async function registerShareModule(
  app: FastifyInstance,
  deps: { shareTokenRepository?: ShareTokenRepository; saveRepository: SaveRepository }
): Promise<void> {
  if (!deps.shareTokenRepository) return;
  await registerShareRoutes(app, {
    createShareLinkUseCase: new CreateShareLinkUseCase(deps.shareTokenRepository),
    getSharedGameUseCase: new GetSharedGameUseCase(deps.shareTokenRepository, deps.saveRepository),
  });
}
