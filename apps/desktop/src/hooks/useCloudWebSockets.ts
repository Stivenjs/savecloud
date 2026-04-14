import { useEffect, useRef } from "react";
import { useConfig } from "@hooks/useConfig";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { hasUsableCloudConnection } from "@utils/cloudConnection";
import { getFriendConfig, setCloudHostWsUrl } from "@services/tauri/config.service";

/**
 * Mensaje recibido desde el WebSocket de la nube (Rust -> TS)
 */
interface CloudIncomingMessage {
  type: "FRIEND_PLAYING" | "ERROR";
  data: {
    friendUserId?: string;
    gameName?: string;
    message?: string;
  };
}

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
  const prevGameStatusRef = useRef<Record<string, boolean>>({});
  const lastBroadcastedGameIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!config?.userId || !hasUsableCloudConnection(config)) {
      invoke("stop_cloud_ws").catch(() => {});
      return;
    }

    const hostId = config.activeCloudHostUserId;
    const isUsingHostCloud = !!hostId;
    let activeWsBaseUrl = isUsingHostCloud ? config.cloudHostWsBaseUrls?.[hostId] : config.wsBaseUrl;

    let isComponentMounted = true;
    let unlistenIncoming: (() => void) | undefined;

    async function setupCloudService() {
      if (!isComponentMounted) return;

      if (isUsingHostCloud && hostId && !activeWsBaseUrl) {
        try {
          const friendCfg = await getFriendConfig(hostId);
          if (friendCfg?.wsBaseUrl) {
            await setCloudHostWsUrl(hostId, friendCfg.wsBaseUrl);
            refetch();
          }
        } catch (e) {
          // Error silencioso
        }
      }

      // Iniciar el servicio en Rust (las credenciales se gestionan internamente)
      try {
        await invoke("start_cloud_ws");
      } catch (e) {
        // Error silencioso
      }

      // Escuchar mensajes entrantes desde Rust
      if (isComponentMounted) {
        unlistenIncoming = await listen<CloudIncomingMessage>("cloud-ws-incoming", (event) => {
          const msg = event.payload;

          if (msg.type === "FRIEND_PLAYING") {
            const { friendUserId, gameName } = msg.data;

            invoke("show_overlay_notification", {
              title: "Amigo jugando",
              body: `${friendUserId} está jugando ${gameName}`,
            }).catch(() => {});
          }
        });
      }
    }

    setupCloudService();

    return () => {
      isComponentMounted = false;
      unlistenIncoming?.();
    };
  }, [config?.activeCloudHostUserId, config?.wsBaseUrl, config?.cloudHostWsBaseUrls, config?.userId, refetch]);

  useEffect(() => {
    if (!config?.userId) return;

    let unlistenStatus: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlistenStatus = await listen<Record<string, boolean>>("games-running-status", (event) => {
          const currentStatus = event.payload;
          const prevStatus = prevGameStatusRef.current;

          for (const [gameId, isRunning] of Object.entries(currentStatus)) {
            const wasNotRunning = !prevStatus[gameId];

            if (isRunning && wasNotRunning) {
              if (lastBroadcastedGameIdRef.current !== gameId) {
                lastBroadcastedGameIdRef.current = gameId;
                broadcastGameStart(gameId);

                // Resetear el lock después de un tiempo para permitir re-detección si el juego se cierra y abre
                setTimeout(() => {
                  if (lastBroadcastedGameIdRef.current === gameId) {
                    lastBroadcastedGameIdRef.current = null;
                  }
                }, 10000);
              }
            }
          }

          prevGameStatusRef.current = { ...currentStatus };
        });
      } catch (e) {
        // Error silencioso en UI
      }
    };

    function broadcastGameStart(gameId: string) {
      if (!config?.userId) return;

      const gameNode = config.games?.find((g) => g.id === gameId);
      const gameName = gameNode?.editionLabel ? `${gameId} (${gameNode.editionLabel})` : gameId;

      invoke("send_cloud_broadcast", { gameId, gameName }).catch(() => {});

      // El mensaje decorativo "Tú estás jugando" solo se muestra en desarrollo para pruebas.
      if (import.meta.env.DEV) {
        invoke("show_overlay_notification", {
          title: "Tú estás jugando",
          body: `Iniciaste ${gameName}`,
        }).catch(() => {});
      }
    }

    setupListener();

    return () => {
      unlistenStatus?.();
    };
  }, [config?.userId, config?.games]);
}
