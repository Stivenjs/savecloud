import type { FastifyInstance } from "fastify";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import type { SaveRepository } from "@domain/ports/SaveRepository";
import { CreateCloudInviteUseCase } from "@application/use-cases/CreateCloudInviteUseCase";
import { GetFriendProfileUseCase } from "@application/use-cases/GetFriendProfileUseCase";
import { ListCloudPresenceUseCase } from "@application/use-cases/ListCloudPresenceUseCase";
import { ListPendingCloudInvitesUseCase } from "@application/use-cases/ListPendingCloudInvitesUseCase";
import { ResolveCloudStorageScopeUseCase } from "@application/use-cases/ResolveCloudStorageScopeUseCase";
import { RespondCloudInviteUseCase } from "@application/use-cases/RespondCloudInviteUseCase";
import { SetCloudGameShareUseCase } from "@application/use-cases/SetCloudGameShareUseCase";
import { registerInviteRoutes } from "@interfaces/http/routes/invites.routes";
import { registerProfileRoutes } from "@interfaces/http/routes/users.routes";

export async function registerInvitesModule(
  app: FastifyInstance,
  deps: {
    saveRepository: SaveRepository;
    cloudInviteRepository?: CloudInviteRepository;
    connectionRepository?: ConnectionRepository;
    resolveCloudStorageScopeUseCase?: ResolveCloudStorageScopeUseCase;
  }
): Promise<void> {
  if (!deps.cloudInviteRepository) return;

  await registerInviteRoutes(app, {
    createCloudInviteUseCase: new CreateCloudInviteUseCase(deps.cloudInviteRepository),
    listPendingCloudInvitesUseCase: new ListPendingCloudInvitesUseCase(deps.cloudInviteRepository),
    respondCloudInviteUseCase: new RespondCloudInviteUseCase(deps.cloudInviteRepository),
    setCloudGameShareUseCase: new SetCloudGameShareUseCase(deps.cloudInviteRepository),
    listCloudPresenceUseCase: deps.connectionRepository
      ? new ListCloudPresenceUseCase(deps.cloudInviteRepository, deps.connectionRepository)
      : undefined,
    cloudInviteRepository: deps.cloudInviteRepository,
  });

  if (deps.resolveCloudStorageScopeUseCase) {
    await registerProfileRoutes(app, {
      getFriendProfileUseCase: new GetFriendProfileUseCase(
        deps.saveRepository,
        deps.cloudInviteRepository,
        deps.resolveCloudStorageScopeUseCase
      ),
    });
  }
}
