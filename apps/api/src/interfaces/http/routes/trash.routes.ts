import type { FastifyInstance } from "fastify";
import { createTrashHandlers, type TrashHandlerDependencies } from "@interfaces/http/handlers/trashHandlers";
import { GameIdBodySchema, type GameIdBody } from "@interfaces/schema/trash";

export type TrashRoutesDependencies = TrashHandlerDependencies;

export async function registerTrashRoutes(app: FastifyInstance, deps: TrashRoutesDependencies): Promise<void> {
  const handlers = createTrashHandlers(deps);

  // GET /trash y GET /saves/trash - Lista los juegos en papelera
  app.get("/trash", handlers.list);
  app.get("/saves/trash", handlers.list);

  // POST /trash/restore y POST /saves/trash/restore - Restaura un juego de la papelera
  app.post<{ Body: GameIdBody }>("/trash/restore", { schema: { body: GameIdBodySchema } }, handlers.restore);
  app.post<{ Body: GameIdBody }>("/saves/trash/restore", { schema: { body: GameIdBodySchema } }, handlers.restore);

  // POST /trash/delete y POST /saves/trash/delete - Elimina definitivamente un juego de la papelera
  app.post<{ Body: GameIdBody }>("/trash/delete", { schema: { body: GameIdBodySchema } }, handlers.delete);
  app.post<{ Body: GameIdBody }>("/saves/trash/delete", { schema: { body: GameIdBodySchema } }, handlers.delete);

  // POST /trash/empty, POST /saves/trash/empty, DELETE /trash, DELETE /saves/trash - Vacía toda la papelera
  app.post("/trash/empty", handlers.empty);
  app.post("/saves/trash/empty", handlers.empty);
  app.delete("/trash", handlers.empty);
  app.delete("/saves/trash", handlers.empty);
}
