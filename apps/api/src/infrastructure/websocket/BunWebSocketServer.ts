/**
 * @file BunWebSocketServer.ts
 * @description Adaptador de infraestructura HTTP/WebSocket nativo para el runtime Bun.
 * Delega peticiones HTTP a la aplicación Fastify mediante `app.inject` y gestiona
 * el ciclo de vida de WebSockets con el motor nativo en C++ (`Bun.serve`).
 */

import type { FastifyInstance, InjectOptions } from "fastify";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import type { FastifyWebSocketNotifier } from "@infrastructure/websocket/FastifyWebSocketNotifier";
import { verifyUserAccessToken } from "@shared/accessToken";
import { safeCompareSecret } from "@shared/safeCompare";
import type { AccessSessionRepository } from "@domain/ports/AccessSessionRepository";

/**
 * Datos asociados al contexto de cada conexión WebSocket en Bun.
 */
export interface BunWsSocketData {
  /** Identificador único de la conexión activa */
  connectionId: string;
  /** ID del usuario autenticado (si está presente) */
  userId?: string;
  /** ID del dispositivo emisor */
  deviceId?: string;
}

/**
 * Estructura de payload de mensajes JSON entrantes por WebSocket.
 */
export interface BunWsIncomingPayload {
  /** Acción solicitada por el cliente (ej. "ping", "broadcast") */
  action?: string;
  /** Tipo de mensaje o evento */
  type?: string;
  /** Identificador del juego activo */
  gameId?: string;
  /** Nombre descriptivo del juego activo */
  gameName?: string;
  /** ID del usuario emisor del evento */
  broadcasterUserId?: string;
}

/**
 * Opciones de configuración para el arranque del servidor nativo de Bun.
 */
export interface StartBunServerOptions {
  /** Puerto de red en el que escuchará el servidor */
  port: number;
  /** Dirección de red de escucha (ej. "0.0.0.0") */
  host: string;
  /** Instancia configurada de la aplicación Fastify */
  app: FastifyInstance;
  /** Repositorio opcional de conexiones de presencia */
  connectionRepository?: ConnectionRepository;
  /** Notificador WebSocket local en memoria */
  webSocketNotifier?: FastifyWebSocketNotifier;
  accessSessionRepository?: AccessSessionRepository;
}

/** Tiempo de vida predeterminado para registros de conexión en DynamoDB (24 horas) */
const CONNECTION_TTL_SECONDS = 24 * 60 * 60;

async function getAuthorizedWebSocketIdentity(
  request: Request,
  accessSessionRepository?: AccessSessionRepository
): Promise<{ userId: string; deviceId?: string } | null> {
  const expectedApiKey = process.env.API_KEY?.trim();
  const userId = request.headers.get("x-user-id")?.trim() ?? "";
  const deviceId = request.headers.get("x-device-id")?.trim() || undefined;
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const credential = request.headers.get("x-api-key")?.trim() || bearer || "";

  if (!userId || !credential) return null;
  if (expectedApiKey && safeCompareSecret(credential, expectedApiKey)) return { userId, deviceId };

  const accessToken = verifyUserAccessToken(credential);
  if (!accessToken?.sessionId || !accessToken.hostUserId || userId !== accessToken.userId || !accessSessionRepository) {
    return null;
  }
  const session = await accessSessionRepository.get(accessToken.sessionId);
  if (
    !session ||
    !session.active ||
    session.userId !== accessToken.userId ||
    session.hostUserId !== accessToken.hostUserId ||
    session.expiresAtEpoch <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return { userId, deviceId };
}

/**
 * Delega una petición HTTP estándar a la instancia de Fastify vía `app.inject` de forma asíncrona.
 *
 * @param req - Objeto Request nativo de Bun.
 * @param url - Objeto URL parseado.
 * @param app - Instancia de Fastify.
 * @returns {Promise<Response>} Respuesta HTTP formateada.
 */
async function handleHttpRoute(req: Request, url: URL, app: FastifyInstance): Promise<Response> {
  const headers: Record<string, string> = {};
  req.headers.forEach((val, key) => {
    headers[key] = val;
  });

  const bodyBuffer = req.body ? Buffer.from(await req.arrayBuffer()) : undefined;

  const res = await app.inject({
    method: req.method as InjectOptions["method"],
    url: url.pathname + url.search,
    headers,
    payload: bodyBuffer,
  });

  const responseHeaders = new Headers();
  for (const [key, val] of Object.entries(res.headers)) {
    if (val !== undefined) {
      if (Array.isArray(val)) {
        for (const v of val) responseHeaders.append(key, v);
      } else {
        responseHeaders.set(key, String(val));
      }
    }
  }

  return new Response(res.rawPayload as unknown as BodyInit, {
    status: res.statusCode,
    headers: responseHeaders,
  });
}

/**
 * Arranca un servidor nativo de Bun (`Bun.serve`) que delega las rutas HTTP a Fastify
 * y procesa las conexiones WebSocket de forma nativa mediante C++.
 *
 * @param options - Opciones de configuración e inyección de dependencias.
 * @returns {Promise<void>}
 */
export async function startBunServer(options: StartBunServerOptions): Promise<void> {
  const { port, host, app, connectionRepository, webSocketNotifier } = options;

  await app.ready();

  const bunApi = (globalThis as unknown as { Bun: typeof import("bun") }).Bun;
  if (!bunApi) {
    throw new Error("[BunWebSocketServer] Bun runtime no detectado en el entorno global.");
  }

  bunApi.serve<BunWsSocketData>({
    port,
    hostname: host,
    async fetch(req, server) {
      const url = new URL(req.url);

      const isWebSocket = req.headers.get("upgrade")?.toLowerCase() === "websocket";
      const identity = isWebSocket ? await getAuthorizedWebSocketIdentity(req, options.accessSessionRepository) : null;
      if (isWebSocket && !identity) return new Response("No autorizado.", { status: 401 });

      const userId = identity?.userId;
      const deviceId = identity?.deviceId;
      const connectionId = `ws_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const upgraded = server.upgrade(req, {
        data: { connectionId, userId, deviceId },
      });

      if (upgraded) {
        return undefined;
      }

      return handleHttpRoute(req, url, app);
    },
    websocket: {
      perMessageDeflate: true,
      open(ws) {
        const { connectionId, userId, deviceId } = ws.data;
        if (webSocketNotifier) {
          webSocketNotifier.registerSocket(connectionId, ws, userId);
        }

        if (connectionRepository && userId) {
          const ttl = Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS;
          connectionRepository.saveConnection(connectionId, userId, ttl, deviceId).catch((err: unknown) => {
            console.error("[SaveCloud WS Bun] Error registrando conexión en DynamoDB:", err);
          });
        }
      },
      message(ws, message) {
        try {
          const parsed = JSON.parse(message.toString()) as BunWsIncomingPayload;
          if (parsed.action === "ping") {
            ws.send(JSON.stringify({ type: "PONG" }));
          } else if (parsed.action === "broadcast" && connectionRepository) {
            const gameId = parsed.gameId?.trim() ?? "";
            const gameName = parsed.gameName?.trim() ?? "";
            connectionRepository
              .setConnectionActivity(ws.data.connectionId, {
                lastActivityAt: Date.now(),
                activityGameId: gameId || null,
                activityGameName: gameId ? gameName || gameId : null,
              })
              .catch((err: unknown) => {
                console.error("[SaveCloud WS Bun] Error actualizando actividad:", err);
              });
          }
        } catch {
          // Ignorar payloads JSON malformados
        }
      },
      close(ws) {
        const { connectionId } = ws.data;
        if (webSocketNotifier) {
          webSocketNotifier.unregisterSocket(connectionId);
        }
        if (connectionRepository) {
          connectionRepository.deleteConnection(connectionId).catch((err: unknown) => {
            console.error("[SaveCloud WS Bun] Error eliminando conexión:", err);
          });
        }
      },
    },
  });

  console.log(`[SaveCloud API] Bun native HTTP/WS server listening on http://${host}:${port}`);
}
