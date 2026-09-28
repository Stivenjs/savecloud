import type { FastifyRequest } from "fastify";
import type { WebSocket, RawData } from "ws";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";

interface LocalSocketRegistry {
  registerSocket(connectionId: string, socket: WebSocket): void;
  unregisterSocket(connectionId: string): void;
}

interface WsIncomingPayload {
  action?: string;
  type?: string;
  gameId?: string;
  gameName?: string;
  broadcasterUserId?: string;
}

export interface WebSocketConnectionDependencies {
  connectionRepository?: ConnectionRepository;
  webSocketNotifier?: LocalSocketRegistry;
}

const CONNECTION_TTL_SECONDS = 24 * 60 * 60;

export function createWebSocketConnectionHandler(deps: WebSocketConnectionDependencies) {
  return (socket: WebSocket, request: FastifyRequest) => {
    const connectionId = `ws_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const query = (request.query as Record<string, string> | undefined) ?? {};
    const userId = query.userId?.trim();
    const deviceId = query.deviceId?.trim();

    console.log(
      `[SaveCloud WS] Handshake exitoso! connectionId=${connectionId}, userId=${userId || "anónimo"}, url=${request.url}`
    );

    deps.webSocketNotifier?.registerSocket(connectionId, socket);

    if (deps.connectionRepository && userId) {
      const ttl = Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS;
      deps.connectionRepository.saveConnection(connectionId, userId, ttl, deviceId).catch((err: unknown) => {
        console.error("[SaveCloud WS] Error registrando conexión en DynamoDB:", err);
      });
    }

    socket.on("message", (data: RawData) => {
      try {
        const parsed = JSON.parse(data.toString("utf-8")) as WsIncomingPayload;
        if (parsed.action === "ping") {
          socket.send(JSON.stringify({ type: "PONG" }));
        } else if (parsed.action === "broadcast" && deps.connectionRepository && parsed.gameName && parsed.gameId) {
          deps.connectionRepository
            .setConnectionActivity(connectionId, {
              lastActivityAt: Date.now(),
              activityGameId: parsed.gameId,
              activityGameName: parsed.gameName,
            })
            .catch((err: unknown) => console.error("[SaveCloud WS] Error actualizando actividad de juego:", err));
        }
      } catch {
        // Los mensajes malformados se ignoran para mantener viva la conexión.
      }
    });

    const cleanup = () => {
      console.log(`[SaveCloud WS] Conexión cerrada: connectionId=${connectionId}`);
      deps.webSocketNotifier?.unregisterSocket(connectionId);
      deps.connectionRepository?.deleteConnection(connectionId).catch((err: unknown) => {
        console.error("[SaveCloud WS] Error eliminando conexión en DynamoDB:", err);
      });
    };

    socket.on("close", cleanup);
    socket.on("error", (err) => {
      console.error(`[SaveCloud WS] Error en socket ${connectionId}:`, err);
      cleanup();
    });
  };
}
