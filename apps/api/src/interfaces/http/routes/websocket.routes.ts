/**
 * @file websocket.routes.ts
 * @description Módulo de infraestructura HTTP/WebSocket para la gestión de sockets en tiempo real,
 * autenticación de conexiones y persistencia de presencia en el almacén DynamoDB.
 *
 * Sigue los principios de Clean Architecture encauzando la infraestructura Fastify
 * hacia los puertos de dominio (ConnectionRepository).
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket, RawData } from "ws";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import type { FastifyWebSocketNotifier } from "@infrastructure/websocket/FastifyWebSocketNotifier";

/**
 * Tiempo de vida (TTL) predeterminado para las conexiones en DynamoDB (24 horas).
 */
const CONNECTION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Representa la estructura de los payloads JSON recibidos a través del canal WebSocket.
 */
export interface WsIncomingPayload {
  /** Acción ejecutada por el cliente (ej. "ping", "broadcast") */
  action?: string;
  /** Tipo de mensaje de respuesta o señal */
  type?: string;
  /** Identificador único del juego activo */
  gameId?: string;
  /** Nombre descriptivo del juego activo */
  gameName?: string;
  /** ID del usuario emisor del broadcast */
  broadcasterUserId?: string;
}

/**
 * Dependencias requeridas para la registración de las rutas de WebSocket.
 */
export interface WebSocketRouteDependencies {
  /** Puerto de persistencia de conexiones en la base de datos */
  connectionRepository?: ConnectionRepository;
  /** Notificador WebSocket local para standalone/Docker */
  webSocketNotifier?: FastifyWebSocketNotifier;
}

/**
 * Registra los endpoints de conexión WebSocket (`/`, `/ws`, `/dev`, `/dev/ws`) en la instancia de Fastify.
 *
 * @param {FastifyInstance} app - Instancia principal del servidor Fastify.
 * @param {WebSocketRouteDependencies} deps - Contenedor de dependencias inyectadas.
 * @returns {Promise<void>}
 */
export async function registerWebSocketRoutes(app: FastifyInstance, deps: WebSocketRouteDependencies): Promise<void> {
  await app.register(async (wsScope) => {
    /**
     * Manejador centralizado del ciclo de vida de una conexión WebSocket.
     *
     * @param {WebSocket} socket - Socket WS activo.
     * @param {FastifyRequest} request - Petición HTTP inicial de upgrade.
     */
    const handleWsConnection = (socket: WebSocket, request: FastifyRequest) => {
      const connectionId = `ws_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const query = (request.query as Record<string, string> | undefined) ?? {};
      const userId = query.userId?.trim();
      const deviceId = query.deviceId?.trim();

      console.log(
        `[SaveCloud WS] Handshake exitoso! connectionId=${connectionId}, userId=${userId || "anónimo"}, url=${request.url}`
      );

      if (deps.webSocketNotifier) {
        deps.webSocketNotifier.registerSocket(connectionId, socket);
      }

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
              .catch((err: unknown) => {
                console.error("[SaveCloud WS] Error actualizando actividad de juego:", err);
              });
          }
        } catch {}
      });

      const cleanup = () => {
        console.log(`[SaveCloud WS] Conexión cerrada: connectionId=${connectionId}`);
        if (deps.webSocketNotifier) {
          deps.webSocketNotifier.unregisterSocket(connectionId);
        }
        if (deps.connectionRepository) {
          deps.connectionRepository.deleteConnection(connectionId).catch((err: unknown) => {
            console.error("[SaveCloud WS] Error eliminando conexión en DynamoDB:", err);
          });
        }
      };

      socket.on("close", cleanup);
      socket.on("error", (err) => {
        console.error(`[SaveCloud WS] Error en socket ${connectionId}:`, err);
        cleanup();
      });
    };

    app.get("/ws", { websocket: true }, handleWsConnection);
    app.get("/", { websocket: true }, handleWsConnection);
    app.get("/dev", { websocket: true }, handleWsConnection);
    app.get("/dev/ws", { websocket: true }, handleWsConnection);
  });
}
