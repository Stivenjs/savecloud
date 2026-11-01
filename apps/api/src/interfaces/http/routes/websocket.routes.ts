import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import { ApplicationError } from "@application/errors/ApplicationError";
import {
  createWebSocketConnectionHandler,
  type WebSocketConnectionDependencies,
} from "@interfaces/http/handlers/webSocketConnectionHandler";

export interface WebSocketRouteDependencies extends WebSocketConnectionDependencies {
  connectionRepository?: ConnectionRepository;
}

/** Registra los endpoints WebSocket y exige identidad resuelta por el hook global de autenticación. */
export async function registerWebSocketRoutes(app: FastifyInstance, deps: WebSocketRouteDependencies): Promise<void> {
  const handleConnection = createWebSocketConnectionHandler(deps);
  const requireAuthenticatedUser = async (request: FastifyRequest): Promise<void> => {
    if (!request.scAuthenticatedUserId) {
      throw new ApplicationError("UNAUTHENTICATED", "No autorizado.");
    }
  };
  const routeOptions = () => ({ websocket: true as const, preValidation: requireAuthenticatedUser });

  await app.register(async (wsScope) => {
    wsScope.get("/ws", routeOptions(), handleConnection);
    wsScope.get("/", routeOptions(), handleConnection);
    wsScope.get("/dev", routeOptions(), handleConnection);
    wsScope.get("/dev/ws", routeOptions(), handleConnection);
  });
}
