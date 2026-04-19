import { useEffect, useMemo, useRef } from "react";
import { useConfig } from "@hooks/useConfig";
import { useProfileSession } from "@hooks/useProfileSession";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { buildActiveCloudConfig } from "@utils/activeCloudConfig";
import { hasUsableCloudConnection } from "@utils/cloudConnection";
import { formatGameDisplayName } from "@utils/gameImage";
import { getFriendConfig, setCloudHostWsUrl } from "@services/tauri/config.service";

/**
 * Mensaje recibido desde el WebSocket de la nube (Rust -> TS)
 */
interface CloudIncomingMessage {
  type: "FRIEND_PLAYING" | "PRESENCE_UPDATE" | "ERROR";
  data: {
    friendUserId?: string;
    userId?: string;
    status?: "online" | "playing";
    gameId?: string;
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
  const { activeProfile } = useProfileSession();
  const queryClient = useQueryClient();
  const prevGameStatusRef = useRef<Record<string, boolean>>({});
  const lastBroadcastedGameIdRef = useRef<string | null>(null);
  const lastBroadcastByGameRef = useRef<Record<string, number>>({});
  const stopCooldownByGameRef = useRef<Record<string, number>>({});

  const activeUserId = activeProfile?.localUserId?.trim() ?? "";
  const cloudConfig = useMemo(() => buildActiveCloudConfig(config, activeProfile), [config, activeProfile]);

  useEffect(() => {
    if (!activeUserId || cloudConfig == null || !hasUsableCloudConnection(cloudConfig)) {
      invoke("stop_cloud_ws").catch(() => {});
      return;
    }

    const hostId = cloudConfig.activeCloudHostUserId;
    const isUsingHostCloud = !!hostId;
    let activeWsBaseUrl = isUsingHostCloud ? cloudConfig.cloudHostWsBaseUrls?.[hostId] : cloudConfig.wsBaseUrl;

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
          // El overlay de FRIEND_PLAYING se dispara desde Rust para evitar duplicados
          // y depender de un solo canal de entrega en producción.
          if (msg.type === "FRIEND_PLAYING") return;
        });
      }
    }

    setupCloudService();

    return () => {
      isComponentMounted = false;
      unlistenIncoming?.();
    };
  }, [activeUserId, cloudConfig, refetch]);

  useEffect(() => {
    if (!activeUserId) return;

    const BROADCAST_REFRESH_MS = 45_000;
    const STOP_BROADCAST_COOLDOWN_MS = 3_000;

    let unlistenStatus: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlistenStatus = await listen<Record<string, boolean>>("games-running-status", (event) => {
          const currentStatus = event.payload;
          const prevStatus = prevGameStatusRef.current;
          const now = Date.now();

          for (const [gameId, isRunning] of Object.entries(currentStatus)) {
            const wasNotRunning = !prevStatus[gameId];
            const wasRunning = !!prevStatus[gameId];

            if (isRunning) {
              const lastSentAt = lastBroadcastByGameRef.current[gameId] ?? 0;
              const shouldRefresh = now - lastSentAt >= BROADCAST_REFRESH_MS;

              if ((wasNotRunning || shouldRefresh) && lastBroadcastedGameIdRef.current !== gameId) {
                lastBroadcastedGameIdRef.current = gameId;
                lastBroadcastByGameRef.current[gameId] = now;
                broadcastGameStart(gameId);

                setTimeout(() => {
                  if (lastBroadcastedGameIdRef.current === gameId) {
                    lastBroadcastedGameIdRef.current = null;
                  }
                }, 5000);
              }
            } else {
              delete lastBroadcastByGameRef.current[gameId];

              if (wasRunning) {
                const lastStopAt = stopCooldownByGameRef.current[gameId] ?? 0;
                if (now - lastStopAt >= STOP_BROADCAST_COOLDOWN_MS) {
                  stopCooldownByGameRef.current[gameId] = now;
                  broadcastGameStop();
                }
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
      if (!activeUserId) return;

      const gameNode = config?.games?.find((g) => g.id === gameId);
      const baseDisplayName = formatGameDisplayName(gameId);
      const editionLabel = gameNode?.editionLabel?.trim();
      const gameName = editionLabel ? `${baseDisplayName} (${editionLabel})` : baseDisplayName;

      invoke("send_cloud_broadcast", { gameId, gameName })
        .then(() => queryClient.invalidateQueries({ queryKey: ["cloud-presence"] }))
        .catch(() => {});

      // El mensaje decorativo "Tú estás jugando" solo se muestra en desarrollo para pruebas.
      if (import.meta.env.DEV) {
        invoke("show_overlay_notification", {
          title: "Tú estás jugando",
          body: `Iniciaste ${gameName}`,
        }).catch(() => {});
      }
    }

    function broadcastGameStop() {
      if (!activeUserId) return;

      // Señaliza estado online/idle al backend sin disparar FRIEND_PLAYING.
      invoke("send_cloud_broadcast", { gameId: "", gameName: "" })
        .then(() => queryClient.invalidateQueries({ queryKey: ["cloud-presence"] }))
        .catch(() => {});
    }

    setupListener();

    return () => {
      unlistenStatus?.();
    };
  }, [activeUserId, config?.games, queryClient]);
}
