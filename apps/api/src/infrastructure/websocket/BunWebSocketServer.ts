/**
 * @file Servidor HTTP/WebSocket de Bun con Fastify como router HTTP.
 * Las solicitudes HTTP se delegan a Fastify; Bun valida y actualiza los sockets
 * WebSocket para conservar el transporte nativo.
 */

import type { FastifyInstance, InjectOptions } from "fastify";
import type { AccessSessionRepository } from "@domain/ports/AccessSessionRepository";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import type { FastifyWebSocketNotifier } from "@infrastructure/websocket/FastifyWebSocketNotifier";
import { ApplicationError } from "@application/errors/ApplicationError";
import {
  authenticateRequestCredential,
  extractRequestCredential,
  type AuthenticatedRequestIdentity,
} from "@application/use-cases/AuthenticateRequestCredential";

/** Rutas que la API publica para conexiones WebSocket. */
const WEBSOCKET_PATHS = new Set(["/", "/ws", "/dev", "/dev/ws"]);
/** Duración de los registros de conexión en el repositorio. */
const CONNECTION_TTL_SECONDS = 24 * 60 * 60;
/** Agrupa los cambios frecuentes de actividad para reducir escrituras de presencia. */
const ACTIVITY_FLUSH_INTERVAL_MS = 250;
/** Respuesta reutilizada para los mensajes de ping de la aplicación. */
const PONG_MESSAGE = '{"type":"PONG"}';

/** Contexto persistente asociado a un socket WebSocket de Bun. */
export interface BunWsSocketData {
  /** Identificador único de esta conexión. */
  connectionId: string;
  /** Usuario autenticado durante el handshake. */
  userId: string;
  /** Identificador opcional del dispositivo emisor. */
  deviceId?: string;
}

/** Campos reconocidos en los mensajes JSON de los clientes WebSocket. */
export interface BunWsIncomingPayload {
  /** Acción solicitada, como `ping` o `broadcast`. */
  action?: string;
  /** Tipo de evento opcional. */
  type?: string;
  /** Identificador del juego activo. */
  gameId?: string;
  /** Nombre del juego activo. */
  gameName?: string;
  /** Usuario declarado como emisor del evento. */
  broadcasterUserId?: string;
}

/** Dependencias necesarias para iniciar el servidor nativo de Bun. */
export interface StartBunServerOptions {
  /** Puerto TCP de escucha. */
  port: number;
  /** Host de escucha, normalmente `0.0.0.0`. */
  host: string;
  /** Aplicación Fastify preparada para resolver solicitudes HTTP. */
  app: FastifyInstance;
  /** Repositorio opcional de presencia y actividad de conexiones. */
  connectionRepository?: ConnectionRepository;
  /** Registro local usado para enviar notificaciones a sockets activos. */
  webSocketNotifier?: FastifyWebSocketNotifier;
  /** Repositorio requerido para verificar tokens de sesión. */
  accessSessionRepository?: AccessSessionRepository;
}

interface ConnectionActivity {
  lastActivityAt: number;
  activityGameId: string | null;
  activityGameName: string | null;
}

interface PendingActivity {
  value: ConnectionActivity;
  timer: ReturnType<typeof setTimeout>;
}

/** Serializa las escrituras por conexión para que un cierre no adelante a su alta. */
function enqueueConnectionOperation(
  operations: Map<string, Promise<void>>,
  connectionId: string,
  operation: () => Promise<void>
): Promise<void> {
  const previous = operations.get(connectionId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  operations.set(connectionId, current);
  void current.then(
    () => {
      if (operations.get(connectionId) === current) operations.delete(connectionId);
    },
    () => {
      if (operations.get(connectionId) === current) operations.delete(connectionId);
    }
  );
  return current;
}

/** Valida la credencial compartida con el hook HTTP y requiere un usuario para el socket. */
async function authenticateWebSocketUpgrade(
  request: Request,
  accessSessionRepository?: AccessSessionRepository
): Promise<{ userId: string; deviceId?: string } | null> {
  const headers = request.headers;
  let identity: AuthenticatedRequestIdentity | null;
  try {
    identity = await authenticateRequestCredential({
      credential: extractRequestCredential(
        headers.get("x-api-key") ?? undefined,
        headers.get("authorization") ?? undefined
      ),
      declaredUserId: headers.get("x-user-id") ?? undefined,
      expectedApiKey: process.env.API_KEY,
      accessSessionRepository,
    });
  } catch (error) {
    if (error instanceof ApplicationError && error.code === "UNAUTHENTICATED") return null;
    throw error;
  }

  if (!identity?.userId) return null;
  return {
    userId: identity.userId,
    deviceId: headers.get("x-device-id")?.trim() || undefined,
  };
}

/** Convierte una solicitud Fetch de Bun a la entrada de prueba HTTP de Fastify. */
async function handleHttpRoute(req: Request, url: URL, app: FastifyInstance): Promise<Response> {
  const headers: Record<string, string> = {};
  req.headers.forEach((value, name) => {
    headers[name] = value;
  });

  const body = req.body === null ? undefined : Buffer.from(await req.arrayBuffer());
  const result = await app.inject({
    method: req.method as InjectOptions["method"],
    url: url.pathname + url.search,
    headers,
    payload: body,
  });

  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(result.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) responseHeaders.append(name, item);
    } else {
      responseHeaders.set(name, String(value));
    }
  }

  return new Response(result.rawPayload as unknown as BodyInit, {
    status: result.statusCode,
    headers: responseHeaders,
  });
}

/** Inicia Bun.serve para HTTP y WebSocket, compartiendo la autenticación con Fastify. */
export async function startBunServer(options: StartBunServerOptions): Promise<void> {
  const { port, host, app, connectionRepository, webSocketNotifier, accessSessionRepository } = options;
  const bunApi = (globalThis as unknown as { Bun?: typeof import("bun") }).Bun;
  if (!bunApi) throw new Error("[BunWebSocketServer] Bun runtime no detectado en el entorno global.");

  await app.ready();

  const connectionOperations = new Map<string, Promise<void>>();
  const pendingActivities = new Map<string, PendingActivity>();

  const persistActivity = (connectionId: string, activity: ConnectionActivity): Promise<void> => {
    if (!connectionRepository) return Promise.resolve();
    return enqueueConnectionOperation(connectionOperations, connectionId, () =>
      connectionRepository.setConnectionActivity(connectionId, activity)
    );
  };

  bunApi.serve<BunWsSocketData>({
    port,
    hostname: host,
    async fetch(request, server) {
      const url = new URL(request.url);
      const isWebSocketUpgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket";

      if (isWebSocketUpgrade) {
        if (!WEBSOCKET_PATHS.has(url.pathname)) {
          return new Response("Not Found", { status: 404 });
        }

        const identity = await authenticateWebSocketUpgrade(request, accessSessionRepository);
        if (!identity) return new Response("No autorizado.", { status: 401 });

        const upgraded = server.upgrade(request, {
          data: {
            connectionId: crypto.randomUUID(),
            ...identity,
          },
        });
        return upgraded ? undefined : new Response("No se pudo actualizar la conexión.", { status: 400 });
      }

      return handleHttpRoute(request, url, app);
    },
    websocket: {
      perMessageDeflate: true,
      open(socket) {
        const { connectionId, userId, deviceId } = socket.data;
        webSocketNotifier?.registerSocket(connectionId, socket, userId);

        if (connectionRepository) {
          const expiresAt = Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS;
          void enqueueConnectionOperation(connectionOperations, connectionId, () =>
            connectionRepository.saveConnection(connectionId, userId, expiresAt, deviceId)
          ).catch((error: unknown) => {
            console.error("[SaveCloud WS Bun] Error registrando conexión:", error);
          });
        }
      },
      message(socket, message) {
        let payload: BunWsIncomingPayload;
        try {
          payload = JSON.parse(typeof message === "string" ? message : message.toString()) as BunWsIncomingPayload;
        } catch {
          return;
        }
        if (payload === null || typeof payload !== "object") return;

        if (payload.action === "ping") {
          socket.send(PONG_MESSAGE);
          return;
        }
        if (payload.action !== "broadcast" || !connectionRepository) return;

        const gameId = payload.gameId?.trim() ?? "";
        const gameName = payload.gameName?.trim() ?? "";
        const activity: ConnectionActivity = {
          lastActivityAt: Date.now(),
          activityGameId: gameId || null,
          activityGameName: gameId ? gameName || gameId : null,
        };
        const { connectionId } = socket.data;
        const pending = pendingActivities.get(connectionId);
        if (pending) {
          pending.value = activity;
          return;
        }

        const timer = setTimeout(() => {
          const latest = pendingActivities.get(connectionId);
          if (!latest) return;
          pendingActivities.delete(connectionId);
          void persistActivity(connectionId, latest.value).catch((error: unknown) => {
            console.error("[SaveCloud WS Bun] Error actualizando actividad:", error);
          });
        }, ACTIVITY_FLUSH_INTERVAL_MS);
        pendingActivities.set(connectionId, { value: activity, timer });
      },
      close(socket) {
        const { connectionId } = socket.data;
        webSocketNotifier?.unregisterSocket(connectionId);
        const pending = pendingActivities.get(connectionId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingActivities.delete(connectionId);
          void persistActivity(connectionId, pending.value).catch((error: unknown) => {
            console.error("[SaveCloud WS Bun] Error actualizando actividad al cerrar:", error);
          });
        }
        if (connectionRepository) {
          void enqueueConnectionOperation(connectionOperations, connectionId, () =>
            connectionRepository.deleteConnection(connectionId)
          ).catch((error: unknown) => {
            console.error("[SaveCloud WS Bun] Error eliminando conexión:", error);
          });
        }
      },
    },
  });

  console.info(`[SaveCloud API] Bun HTTP/WS server listening on http://${host}:${port}`);
}
