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
  type: "FRIEND_PLAYING" | "PRESENCE_UPDATE" | "ERROR" | "STREAM_SIGNAL";
  data: {
    friendUserId?: string;
    userId?: string;
    status?: "online" | "playing";
    gameId?: string;
    gameName?: string;
    message?: string;
    fromUserId?: string;
    targetUserId?: string | null;
    event?: string;
    streamId?: string;
    payload?: unknown;
    timestamp?: number;
  };
}

/**
 * Hook personalizado para gestionar conexiones WebSocket con el servidor cloud.
 *
 * ## Cold-start
 * Cuando la app arranca con un juego ya corriendo, `send_cloud_broadcast` puede
 * llamarse antes de que el WS esté conectado.  El manager de Rust encola el
 * mensaje y lo envía en cuanto el handshake termina, por lo que desde TS no
 * necesitamos lógica de reintento adicional: el `invoke` siempre retorna `Ok`.
 *
 * Sin embargo, para mayor robustez, este hook también detecta si ya hay un juego
 * corriendo en el momento del montaje y emite un broadcast inmediato (que caerá
 * en la cola de Rust si el WS no está listo todavía).
 */
export function useCloudWebSockets() {
  const { config, refetch } = useConfig();
  const { activeProfile } = useProfileSession();
  const queryClient = useQueryClient();

  const prevGameStatusRef = useRef<Record<string, boolean>>({});
  const lastBroadcastedGameIdRef = useRef<string | null>(null);
  const lastBroadcastByGameRef = useRef<Record<string, number>>({});
  const stopCooldownByGameRef = useRef<Record<string, number>>({});

  const initialReplayDoneRef = useRef(false);
  const activeUserId = activeProfile?.localUserId?.trim() ?? "";
  const cloudConfig = useMemo(() => buildActiveCloudConfig(config, activeProfile), [config, activeProfile]);

  useEffect(() => {
    if (!activeUserId || cloudConfig == null || !hasUsableCloudConnection(cloudConfig)) {
      invoke("stop_cloud_ws").catch(() => {});
      return;
    }

    const hostId = cloudConfig.activeCloudHostUserId;
    const isUsingHostCloud = !!hostId;
    const activeWsBaseUrl = isUsingHostCloud ? cloudConfig.cloudHostWsBaseUrls?.[hostId] : cloudConfig.wsBaseUrl;

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
        } catch {
          // Error silencioso
        }
      }

      // Rust maneja internamente la cola de mensajes pendientes;
      // simplemente arrancamos el servicio.
      try {
        await invoke("start_cloud_ws");
      } catch {
        // Error silencioso
      }

      if (isComponentMounted) {
        unlistenIncoming = await listen<CloudIncomingMessage>("cloud-ws-incoming", (event) => {
          const msg = event.payload;
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

    function resolveGameName(gameId: string): string {
      const gameNode = config?.games?.find((g) => g.id === gameId);
      const baseDisplayName = formatGameDisplayName(gameId);
      const editionLabel = gameNode?.editionLabel?.trim();
      return editionLabel ? `${baseDisplayName} (${editionLabel})` : baseDisplayName;
    }

    function broadcastGameStart(gameId: string) {
      if (!activeUserId) return;

      const gameName = resolveGameName(gameId);

      invoke("send_cloud_broadcast", { gameId, gameName })
        .then(() => queryClient.invalidateQueries({ queryKey: ["cloud-presence"] }))
        .catch(() => {});

      if (import.meta.env.DEV) {
        invoke("show_overlay_notification", {
          title: "Tú estás jugando",
          body: `Iniciaste ${gameName}`,
        }).catch(() => {});
      }
    }

    function broadcastGameStop() {
      if (!activeUserId) return;

      invoke("send_cloud_broadcast", { gameId: "", gameName: "" })
        .then(() => queryClient.invalidateQueries({ queryKey: ["cloud-presence"] }))
        .catch(() => {});
    }

    if (!initialReplayDoneRef.current) {
      initialReplayDoneRef.current = true;

      invoke<Record<string, boolean>>("get_running_games_status")
        .then((currentStatus) => {
          const now = Date.now();
          for (const [gameId, isRunning] of Object.entries(currentStatus)) {
            if (isRunning) {
              prevGameStatusRef.current[gameId] = true;
              lastBroadcastByGameRef.current[gameId] = now;
              lastBroadcastedGameIdRef.current = gameId;
              broadcastGameStart(gameId);
            }
          }
        })
        .catch(() => {});
    }

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
                }, 5_000);
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
      } catch {
        // Error silencioso en UI
      }
    };

    setupListener();

    return () => {
      unlistenStatus?.();
    };
  }, [activeUserId, config?.games, queryClient]);
}
