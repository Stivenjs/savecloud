import { useEffect, useRef } from "react";
import { useConfig } from "@hooks/useConfig";
import { listen, emitTo } from "@tauri-apps/api/event";
import { hasUsableCloudConnection } from "@utils/cloudConnection";
import { getFriendConfig, setCloudHostWsUrl } from "@services/tauri/config.service";

/**
 * Mensaje recibido desde el WebSocket del servidor cloud
 */
interface CloudWebSocketMessage {
  type: "FRIEND_PLAYING";
  data: {
    friendUserId: string;
    gameName: string;
  };
}

/**
 * Payload enviado al servidor cuando el usuario inicia un juego
 */
interface BroadcastPayload {
  action: "broadcast";
  broadcasterUserId: string;
  gameId: string;
  gameName: string;
}

/** Tiempo de espera antes de reintentar conexión (ms) */
const RECONNECT_DELAY = 5000;

/**
 * Hook personalizado para gestionar conexiones WebSocket con el servidor cloud.
 *
 * Funcionalidades:
 * - Establece y mantiene conexión WebSocket con el servidor cloud propio o de un host
 * - Reconecta automáticamente en caso de desconexión
 * - Escucha notificaciones de amigos jugando
 * - Emite broadcasts cuando el usuario local inicia un juego
 * - Descubre automáticamente la URL del WebSocket del host si no está disponible
 *
 * @example
 * function MyComponent() {
 *   useCloudWebSockets();
 *   return <div>...</div>;
 * }
 */
export function useCloudWebSockets() {
  const { config, refetch } = useConfig();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevGameStatusRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    // Guard: verificar que tenemos usuario y conexión cloud válida
    if (!config?.userId || !hasUsableCloudConnection(config)) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    const hostId = config.activeCloudHostUserId;
    const isUsingHostCloud = !!hostId;
    let activeWsBaseUrl = isUsingHostCloud ? config.cloudHostWsBaseUrls?.[hostId] : config.wsBaseUrl;

    let isComponentMounted = true;

    /**
     * Asegura que tenemos una URL de WebSocket válida antes de conectar.
     * Si estamos usando cloud de host y no tenemos la URL, la descubre primero.
     */
    async function ensureWsUrlAndConnect() {
      if (!isComponentMounted) return;

      // Descubrir URL del WebSocket del host si es necesario
      if (isUsingHostCloud && hostId && !activeWsBaseUrl) {
        try {
          const friendCfg = await getFriendConfig(hostId);
          if (friendCfg?.wsBaseUrl) {
            await setCloudHostWsUrl(hostId, friendCfg.wsBaseUrl);
            activeWsBaseUrl = friendCfg.wsBaseUrl;
            refetch();
          }
        } catch (error) {
          console.warn("[WS] Error descubriendo WS de host:", error);
        }
      }

      // Si no hay URL disponible, cerrar conexión existente y salir
      if (!activeWsBaseUrl) {
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
        return;
      }

      connect();
    }

    /**
     * Establece la conexión WebSocket y configura los event handlers
     */
    function connect() {
      if (!isComponentMounted || !activeWsBaseUrl || !config?.userId) return;

      // Evitar múltiples conexiones simultáneas
      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      const wsUrl = `${activeWsBaseUrl}?userId=${encodeURIComponent(config?.userId)}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("[WS] Conexión establecida");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as CloudWebSocketMessage;

          if (msg.type === "FRIEND_PLAYING") {
            const { friendUserId, gameName } = msg.data;

            emitTo("overlay", "show-overlay-notification", {
              title: "Amigo jugando",
              body: `${friendUserId} está jugando ${gameName}`,
            }).catch((error) => {
              console.warn("[WS] Error emitiendo notificación overlay:", error);
            });
          }
        } catch (error) {
          console.warn("[WS] Error parseando mensaje:", error);
        }
      };

      ws.onclose = () => {
        console.log("[WS] Conexión cerrada, reintentando...");
        wsRef.current = null;

        if (isComponentMounted) {
          reconnectTimeoutRef.current = setTimeout(connect, RECONNECT_DELAY);
        }
      };

      ws.onerror = (error) => {
        console.warn("[WS] Error en el socket:", error);
      };

      wsRef.current = ws;
    }

    ensureWsUrlAndConnect();

    return () => {
      isComponentMounted = false;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [config?.activeCloudHostUserId, config?.wsBaseUrl, config?.cloudHostWsBaseUrls, config?.userId, refetch]);

  useEffect(() => {
    if (!config?.userId) return;

    let unlisten: (() => void) | undefined;

    /**
     * Escucha eventos de cambios en el estado de juegos ejecutándose
     * y emite broadcasts cuando se inicia un nuevo juego
     */
    const setupListener = async () => {
      try {
        unlisten = await listen<Record<string, boolean>>("games-running-status", (event) => {
          const currentStatus = event.payload;
          const prevStatus = prevGameStatusRef.current;

          // Detectar juegos que acaban de iniciarse
          for (const [gameId, isRunning] of Object.entries(currentStatus)) {
            const wasNotRunning = !prevStatus[gameId];

            if (isRunning && wasNotRunning) {
              broadcastGameStart(gameId);
            }
          }

          // Actualizar referencia del estado previo
          prevGameStatusRef.current = { ...currentStatus };
        });
      } catch (error) {
        console.error("[WS] Error suscribiendo a games-running-status:", error);
      }
    };

    /**
     * Envía un broadcast al servidor cuando se inicia un juego
     * @param gameId - ID del juego iniciado
     */
    function broadcastGameStart(gameId: string) {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || !config?.userId) {
        return;
      }

      const gameNode = config.games?.find((g) => g.id === gameId);
      const gameName = gameNode?.editionLabel ? `${gameId} (${gameNode.editionLabel})` : gameId;

      const payload: BroadcastPayload = {
        action: "broadcast",
        broadcasterUserId: config.userId,
        gameId,
        gameName,
      };

      try {
        wsRef.current.send(JSON.stringify(payload));
        // Solo notificar si estamos en dev
        if (import.meta.env.DEV) {
          emitTo("overlay", "show-overlay-notification", {
            title: "Tú estás jugando",
            body: `Iniciaste ${gameName}`,
          }).catch((error) => {
            console.warn("[WS] Error emitiendo notificación local:", error);
          });
        }
      } catch (error) {
        console.warn("[WS] Error enviando broadcast:", error);
      }
    }

    setupListener();

    return () => {
      unlisten?.();
    };
  }, [config?.userId, config?.games]);
}
