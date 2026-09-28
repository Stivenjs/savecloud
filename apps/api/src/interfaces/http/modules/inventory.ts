import type { FastifyInstance } from "fastify";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import type { GameInventoryRepository } from "@domain/ports/GameInventoryRepository";
import type { WebSocketNotifier } from "@domain/ports/WebSocketNotifier";
import { CreateTransferSessionUseCase } from "@application/use-cases/CreateTransferSessionUseCase";
import { ListGameProvidersUseCase } from "@application/use-cases/ListGameProvidersUseCase";
import { ListPendingTransferSessionsUseCase } from "@application/use-cases/ListPendingTransferSessionsUseCase";
import { PublishDeviceInventoryUseCase } from "@application/use-cases/PublishDeviceInventoryUseCase";
import { RecordInventoryHeartbeatUseCase } from "@application/use-cases/RecordInventoryHeartbeatUseCase";
import { registerInventoryRoutes } from "@interfaces/http/routes/inventory.routes";

export async function registerInventoryModule(
  app: FastifyInstance,
  deps: {
    gameInventoryRepository?: GameInventoryRepository;
    cloudInviteRepository?: CloudInviteRepository;
    connectionRepository?: ConnectionRepository;
    webSocketNotifier?: WebSocketNotifier;
  }
): Promise<void> {
  if (!deps.gameInventoryRepository || !deps.cloudInviteRepository) return;

  await registerInventoryRoutes(app, {
    publishDeviceInventoryUseCase: new PublishDeviceInventoryUseCase(deps.gameInventoryRepository),
    listGameProvidersUseCase: new ListGameProvidersUseCase(deps.gameInventoryRepository, deps.cloudInviteRepository),
    createTransferSessionUseCase: new CreateTransferSessionUseCase(
      deps.gameInventoryRepository,
      deps.cloudInviteRepository,
      deps.connectionRepository,
      deps.webSocketNotifier
    ),
    recordInventoryHeartbeatUseCase: new RecordInventoryHeartbeatUseCase(deps.gameInventoryRepository),
    listPendingTransferSessionsUseCase: new ListPendingTransferSessionsUseCase(deps.gameInventoryRepository),
    gameInventoryRepository: deps.gameInventoryRepository,
  });
}
