import { useEffect, useRef } from "react";
import { useConfig } from "@hooks/useConfig";
import { listen } from "@tauri-apps/api/event";
import { toastInfo } from "@utils/toast";
import { hasUsableCloudConnection } from "@utils/cloudConnection";

export function useCloudWebSockets() {
  const { config } = useConfig();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevGameStatusRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    if (!config || !config.wsBaseUrl || !config.userId || !hasUsableCloudConnection(config)) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    const wsUrl = `${config.wsBaseUrl}?userId=${encodeURIComponent(config.userId)}`;
    let isComponentMounted = true;

    function connect() {
      if (!isComponentMounted) return;
      if (
        wsRef.current &&
        (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      console.debug("[WS] Conectando a", wsUrl);
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.debug("[WS] Conectado exitosamente.");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "FRIEND_PLAYING") {
            const { friendUserId, gameName } = msg.data;
            toastInfo("Amigo jugando", `${friendUserId} empezó a jugar ${gameName}`);
          }
        } catch (e) {
          console.warn("[WS] Error parseando mensaje:", e);
        }
      };

      ws.onclose = () => {
        console.debug("[WS] Desconectado. Reconectando en 5s...");
        if (isComponentMounted) {
          reconnectTimeoutRef.current = setTimeout(connect, 5000);
        }
      };

      ws.onerror = (error) => {
        console.warn("[WS] Error en el socket:", error);
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
      isComponentMounted = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [config?.wsBaseUrl, config?.userId]);

  // Listener para juegos abiertos que emite eventos de broadcast al WebSocket
  useEffect(() => {
    if (!config || !config.userId) return;

    let unlisten: (() => void) | undefined;

    listen<Record<string, boolean>>("games-running-status", (event) => {
      const currentStatus = event.payload;
      const prevStatus = prevGameStatusRef.current;

      for (const [gameId, isRunning] of Object.entries(currentStatus)) {
        if (isRunning && !prevStatus[gameId]) {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && config?.userId) {
            console.debug(`[WS] Notificando apertura de: ${gameId}`);

            const gameNode = config.games.find((g) => g.id === gameId);
            const gameName = gameNode?.editionLabel ? `${gameId} (${gameNode.editionLabel})` : gameId;

            const payload = {
              action: "broadcast",
              broadcasterUserId: config.userId,
              gameId: gameId,
              gameName: gameName,
            };

            wsRef.current.send(JSON.stringify(payload));
          }
        }
      }

      prevGameStatusRef.current = { ...prevStatus, ...currentStatus };
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((err) => {
        console.error("Error suscribiendo a games-running-status para WS", err);
      });

    return () => {
      unlisten?.();
    };
  }, [config?.userId, config?.games]);
}
