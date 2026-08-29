/**
 * @fileoverview Rutas HTTP para la gestión de la papelera de reciclaje en SaveCloud.
 *
 * @module interfaces/http/routes/trash.routes
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import type { ListTrashUseCase } from "@application/use-cases/ListTrashUseCase";
import type { RestoreFromTrashUseCase } from "@application/use-cases/RestoreFromTrashUseCase";
import type { DeleteFromTrashUseCase } from "@application/use-cases/DeleteFromTrashUseCase";
import type { EmptyTrashUseCase } from "@application/use-cases/EmptyTrashUseCase";

export interface TrashRoutesDependencies {
  listTrashUseCase: ListTrashUseCase;
  restoreFromTrashUseCase: RestoreFromTrashUseCase;
  deleteFromTrashUseCase: DeleteFromTrashUseCase;
  emptyTrashUseCase: EmptyTrashUseCase;
}

const GameIdBodySchema = Type.Object({
  gameId: Type.String({ minLength: 1 }),
});

type GameIdBody = {
  gameId: string;
};

function getUserId(request: FastifyRequest): string {
  const header = request.headers["x-user-id"];
  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }
  return "default-user";
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function registerTrashRoutes(app: FastifyInstance, deps: TrashRoutesDependencies): Promise<void> {
  const handleListTrash = async (request: FastifyRequest, reply: import("fastify").FastifyReply) => {
    try {
      const userId = getUserId(request);
      const items = await deps.listTrashUseCase.execute({ userId });
      return reply.send({ items });
    } catch (err) {
      request.log.error({ err }, "list-trash failed");
      return reply.status(500).send({ error: "Internal Server Error", message: getErrorMessage(err) });
    }
  };

  // GET /trash y GET /saves/trash - Lista los juegos en papelera
  app.get("/trash", handleListTrash);
  app.get("/saves/trash", handleListTrash);

  const handleRestoreFromTrash = async (
    request: FastifyRequest<{ Body: GameIdBody }>,
    reply: import("fastify").FastifyReply
  ) => {
    try {
      const userId = getUserId(request);
      const gameId = request.body.gameId.trim();
      await deps.restoreFromTrashUseCase.execute({ userId, gameId });
      return reply.status(204).send();
    } catch (err) {
      request.log.error({ err }, "restore-from-trash failed");
      return reply.status(500).send({ error: "Internal Server Error", message: getErrorMessage(err) });
    }
  };

  // POST /trash/restore y POST /saves/trash/restore - Restaura un juego de la papelera
  app.post<{ Body: GameIdBody }>("/trash/restore", { schema: { body: GameIdBodySchema } }, handleRestoreFromTrash);
  app.post<{ Body: GameIdBody }>(
    "/saves/trash/restore",
    { schema: { body: GameIdBodySchema } },
    handleRestoreFromTrash
  );

  const handleDeleteFromTrash = async (
    request: FastifyRequest<{ Body: GameIdBody }>,
    reply: import("fastify").FastifyReply
  ) => {
    try {
      const userId = getUserId(request);
      const gameId = request.body.gameId.trim();
      await deps.deleteFromTrashUseCase.execute({ userId, gameId });
      return reply.status(204).send();
    } catch (err) {
      request.log.error({ err }, "delete-from-trash failed");
      return reply.status(500).send({ error: "Internal Server Error", message: getErrorMessage(err) });
    }
  };

  // POST /trash/delete y POST /saves/trash/delete - Elimina definitivamente un juego de la papelera
  app.post<{ Body: GameIdBody }>("/trash/delete", { schema: { body: GameIdBodySchema } }, handleDeleteFromTrash);
  app.post<{ Body: GameIdBody }>("/saves/trash/delete", { schema: { body: GameIdBodySchema } }, handleDeleteFromTrash);

  const handleEmptyTrash = async (request: FastifyRequest, reply: import("fastify").FastifyReply) => {
    try {
      const userId = getUserId(request);
      await deps.emptyTrashUseCase.execute({ userId });
      return reply.status(204).send();
    } catch (err) {
      request.log.error({ err }, "empty-trash failed");
      return reply.status(500).send({ error: "Internal Server Error", message: getErrorMessage(err) });
    }
  };

  // POST /trash/empty, POST /saves/trash/empty, DELETE /trash, DELETE /saves/trash - Vacía toda la papelera
  app.post("/trash/empty", handleEmptyTrash);
  app.post("/saves/trash/empty", handleEmptyTrash);
  app.delete("/trash", handleEmptyTrash);
  app.delete("/saves/trash", handleEmptyTrash);
}
