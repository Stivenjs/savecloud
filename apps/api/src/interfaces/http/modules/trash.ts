import type { FastifyInstance } from "fastify";
import type { SaveRepository } from "@domain/ports/SaveRepository";
import { DeleteFromTrashUseCase } from "@application/use-cases/DeleteFromTrashUseCase";
import { EmptyTrashUseCase } from "@application/use-cases/EmptyTrashUseCase";
import { ListTrashUseCase } from "@application/use-cases/ListTrashUseCase";
import { RestoreFromTrashUseCase } from "@application/use-cases/RestoreFromTrashUseCase";
import { registerTrashRoutes } from "@interfaces/http/routes/trash.routes";

export async function registerTrashModule(app: FastifyInstance, saveRepository: SaveRepository): Promise<void> {
  await registerTrashRoutes(app, {
    listTrashUseCase: new ListTrashUseCase(saveRepository),
    restoreFromTrashUseCase: new RestoreFromTrashUseCase(saveRepository),
    deleteFromTrashUseCase: new DeleteFromTrashUseCase(saveRepository),
    emptyTrashUseCase: new EmptyTrashUseCase(saveRepository),
  });
}
