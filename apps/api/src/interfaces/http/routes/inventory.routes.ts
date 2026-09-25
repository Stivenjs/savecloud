import type { FastifyInstance, FastifyReply } from "fastify";
import { getUserId, getErrorMessage } from "@shared/utils";
import type { PublishDeviceInventoryUseCase } from "@application/use-cases/PublishDeviceInventoryUseCase";
import type { ListGameProvidersUseCase } from "@application/use-cases/ListGameProvidersUseCase";
import type { CreateTransferSessionUseCase } from "@application/use-cases/CreateTransferSessionUseCase";
import type { RecordInventoryHeartbeatUseCase } from "@application/use-cases/RecordInventoryHeartbeatUseCase";
import type { ListPendingTransferSessionsUseCase } from "@application/use-cases/ListPendingTransferSessionsUseCase";
import type { GameInventoryRepository } from "@domain/ports/GameInventoryRepository";
import {
  CreateTransferSessionSchema,
  type CreateTransferSessionBody,
  InventoryHeartbeatSchema,
  type InventoryHeartbeatBody,
  PublishDeviceInventorySchema,
  type PublishDeviceInventoryBody,
} from "@interfaces/schema/inventory";

export async function registerInventoryRoutes(
  app: FastifyInstance,
  deps: {
    publishDeviceInventoryUseCase: PublishDeviceInventoryUseCase;
    listGameProvidersUseCase: ListGameProvidersUseCase;
    createTransferSessionUseCase: CreateTransferSessionUseCase;
    recordInventoryHeartbeatUseCase: RecordInventoryHeartbeatUseCase;
    listPendingTransferSessionsUseCase: ListPendingTransferSessionsUseCase;
    gameInventoryRepository: GameInventoryRepository;
  }
): Promise<void> {
  app.put<{ Params: { deviceId: string }; Body: PublishDeviceInventoryBody }>(
    "/inventory/devices/:deviceId",
    { schema: { body: PublishDeviceInventorySchema } },
    async (request, reply: FastifyReply) => {
      try {
        const userId = getUserId(request);
        const deviceId = request.params.deviceId.trim();
        const body = request.body;
        await deps.publishDeviceInventoryUseCase.execute({
          userId,
          deviceId,
          deviceName: body.deviceName,
          manifestVersion: body.manifestVersion,
          contentHash: body.contentHash,
          updatedAt: body.updatedAt,
          sharingEnabled: body.sharingEnabled,
          games: body.games,
        });
        return reply.send({ ok: true });
      } catch (err) {
        return reply.status(400).send({ error: "Bad Request", message: getErrorMessage(err) });
      }
    }
  );

  app.post<{ Params: { deviceId: string }; Body: InventoryHeartbeatBody }>(
    "/inventory/devices/:deviceId/heartbeat",
    { schema: { body: InventoryHeartbeatSchema } },
    async (request, reply: FastifyReply) => {
      try {
        const userId = getUserId(request);
        await deps.recordInventoryHeartbeatUseCase.execute(userId, request.params.deviceId, request.body.appVersion);
        return reply.send({ ok: true });
      } catch (err) {
        return reply.status(400).send({ error: "Bad Request", message: getErrorMessage(err) });
      }
    }
  );

  app.delete<{ Params: { deviceId: string } }>("/inventory/devices/:deviceId", async (request, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      await deps.gameInventoryRepository.deleteDeviceInventory(userId, request.params.deviceId.trim());
      return reply.send({ ok: true });
    } catch (err) {
      return reply.status(400).send({ error: "Bad Request", message: getErrorMessage(err) });
    }
  });

  app.get<{ Querystring: { gameKey?: string } }>("/inventory/providers", async (request, reply: FastifyReply) => {
    try {
      const userId = getUserId(request);
      const gameKey = (request.query.gameKey ?? "").trim();
      if (!gameKey) {
        return reply.status(400).send({ error: "Bad Request", message: "gameKey is required" });
      }
      const result = await deps.listGameProvidersUseCase.execute({ requesterUserId: userId, gameKey });
      return reply.send(result);
    } catch (err) {
      return reply.status(400).send({ error: "Bad Request", message: getErrorMessage(err) });
    }
  });

  app.get<{ Querystring: { deviceId?: string } }>(
    "/inventory/transfer-sessions/pending",
    async (request, reply: FastifyReply) => {
      try {
        getUserId(request);
        const deviceId = (request.query.deviceId ?? "").trim();
        if (!deviceId) {
          return reply.status(400).send({ error: "Bad Request", message: "deviceId is required" });
        }
        const items = await deps.listPendingTransferSessionsUseCase.execute(deviceId);
        return reply.send({ items });
      } catch (err) {
        return reply.status(400).send({ error: "Bad Request", message: getErrorMessage(err) });
      }
    }
  );

  app.post<{ Body: CreateTransferSessionBody }>(
    "/inventory/transfer-sessions",
    { schema: { body: CreateTransferSessionSchema } },
    async (request, reply: FastifyReply) => {
      try {
        const userId = getUserId(request);
        const body = request.body;
        const session = await deps.createTransferSessionUseCase.execute({
          requesterUserId: userId,
          targetUserId: body.targetUserId,
          targetDeviceId: body.targetDeviceId,
          gameKey: body.gameKey,
          manifestHash: body.manifestHash,
        });
        return reply.send(session);
      } catch (err) {
        return reply.status(400).send({ error: "Bad Request", message: getErrorMessage(err) });
      }
    }
  );
}
