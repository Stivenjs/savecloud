import type { FastifyReply, FastifyRequest } from "fastify";
import type { ListTrashUseCase } from "@application/use-cases/ListTrashUseCase";
import type { RestoreFromTrashUseCase } from "@application/use-cases/RestoreFromTrashUseCase";
import type { DeleteFromTrashUseCase } from "@application/use-cases/DeleteFromTrashUseCase";
import type { EmptyTrashUseCase } from "@application/use-cases/EmptyTrashUseCase";
import type { GameIdBody } from "@interfaces/schema/trash";
import { getUserId } from "@interfaces/http/helpers/request-context";

export interface TrashHandlerDependencies {
  listTrashUseCase: ListTrashUseCase;
  restoreFromTrashUseCase: RestoreFromTrashUseCase;
  deleteFromTrashUseCase: DeleteFromTrashUseCase;
  emptyTrashUseCase: EmptyTrashUseCase;
}

export function createTrashHandlers(deps: TrashHandlerDependencies) {
  return {
    list: async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = getUserId(request);
      const items = await deps.listTrashUseCase.execute({ userId });
      return reply.send({ items });
    },
    restore: async (request: FastifyRequest<{ Body: GameIdBody }>, reply: FastifyReply) => {
      const userId = getUserId(request);
      const gameId = request.body.gameId.trim();
      await deps.restoreFromTrashUseCase.execute({ userId, gameId });
      return reply.status(204).send();
    },
    delete: async (request: FastifyRequest<{ Body: GameIdBody }>, reply: FastifyReply) => {
      const userId = getUserId(request);
      const gameId = request.body.gameId.trim();
      await deps.deleteFromTrashUseCase.execute({ userId, gameId });
      return reply.status(204).send();
    },
    empty: async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = getUserId(request);
      await deps.emptyTrashUseCase.execute({ userId });
      return reply.status(204).send();
    },
  };
}
