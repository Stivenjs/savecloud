import type { FastifyRequest } from "fastify";
import type { WebSocket, RawData } from "ws";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import type { WebSocketNotifier } from "@domain/ports/WebSocketNotifier";

interface LocalSocketRegistry {
  registerSocket(connectionId: string, socket: WebSocket, userId?: string): void;
  unregisterSocket(connectionId: string): void;
}

/** Notificador que puede gestionar sockets locales cuando corre fuera de Lambda. */
export type WebSocketConnectionNotifier = WebSocketNotifier & Partial<LocalSocketRegistry>;

interface WsIncomingPayload {
  action?: string;
  type?: string;
  gameId?: string;
  gameName?: string;
  broadcasterUserId?: string;
}

export interface WebSocketConnectionDependencies {
  connectionRepository?: ConnectionRepository;
  webSocketNotifier?: WebSocketConnectionNotifier;
}

const CONNECTION_TTL_SECONDS = 24 * 60 * 60;

/** Crea los callbacks de conexión usando el usuario validado por el hook global de Fastify. */
export function createWebSocketConnectionHandler(deps: WebSocketConnectionDependencies) {
  return (socket: WebSocket, request: FastifyRequest) => {
    const connectionId = `ws_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const userId = request.scAuthenticatedUserId;
    const deviceHeader = request.headers["x-device-id"];
    const deviceId = typeof deviceHeader === "string" ? deviceHeader.trim() : undefined;

    console.log(
      `[SaveCloud WS] Handshake exitoso! connectionId=${connectionId}, userId=${userId || "anónimo"}, path=${request.url.split("?")[0]}`
    );

    deps.webSocketNotifier?.registerSocket?.(connectionId, socket, userId);

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
        } else if (parsed.action === "broadcast" && deps.connectionRepository) {
          const gameId = parsed.gameId?.trim() ?? "";
          const gameName = parsed.gameName?.trim() ?? "";
          deps.connectionRepository
            .setConnectionActivity(connectionId, {
              lastActivityAt: Date.now(),
              activityGameId: gameId || null,
              activityGameName: gameId ? gameName || gameId : null,
            })
            .catch((err: unknown) => console.error("[SaveCloud WS] Error actualizando actividad de juego:", err));
        }
      } catch (err: unknown) {
        console.error("[SaveCloud WS] Error procesando mensaje del socket:", err);
      }
    });

    const cleanup = () => {
      console.log(`[SaveCloud WS] Conexión cerrada: connectionId=${connectionId}`);
      deps.webSocketNotifier?.unregisterSocket?.(connectionId);
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
