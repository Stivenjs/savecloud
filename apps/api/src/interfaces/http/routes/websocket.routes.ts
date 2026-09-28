import type { FastifyInstance } from "fastify";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import {
  createWebSocketConnectionHandler,
  type WebSocketConnectionDependencies,
} from "@interfaces/http/handlers/webSocketConnectionHandler";

export interface WebSocketRouteDependencies extends WebSocketConnectionDependencies {
  connectionRepository?: ConnectionRepository;
}

export async function registerWebSocketRoutes(app: FastifyInstance, deps: WebSocketRouteDependencies): Promise<void> {
  const handleConnection = createWebSocketConnectionHandler(deps);
  await app.register(async (wsScope) => {
    wsScope.get("/ws", { websocket: true }, handleConnection);
    wsScope.get("/", { websocket: true }, handleConnection);
    wsScope.get("/dev", { websocket: true }, handleConnection);
    wsScope.get("/dev/ws", { websocket: true }, handleConnection);
  });
}
