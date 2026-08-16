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
import { useGameSessionStore } from "@store/GameSessionStore";

/**
 * Mensaje entrante desde el WebSocket de la nube (Rust → TS).
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
 * Gestiona la conexión WebSocket con el servidor cloud y el broadcast de
 * presencia de juego en tiempo real.
 *
 * ## Cold-start buffer (Rust)
 * Los broadcasts emitidos antes de que el handshake WS termine se encolan
 * automáticamente en el manager de Rust y se envían en cuanto la conexión
 * se establece.
 */
export function useCloudWebSockets() {
  const { config, loading: configLoading, refetch } = useConfig();
  const { activeProfile, loading: profileLoading } = useProfileSession();
  const queryClient = useQueryClient();

  /**
   * Snapshot del último mapa `gameId → isRunning` recibido desde Rust.
   * Permite detectar transiciones sin depender del estado de React.
   */
  const prevGameStatusRef = useRef<Record<string, boolean>>({});

  /**
   * `gameId` del juego cuyo broadcast fue enviado más recientemente,
   * o `null` si no hay ningún juego activo.
   */
  const lastBroadcastedGameIdRef = useRef<string | null>(null);

  /**
   * Timestamp del último broadcast de *stop* por juego.
   * Cooldown de 3 s para evitar spam si el proceso fluctúa al cerrar.
   */
  const stopCooldownByGameRef = useRef<Record<string, number>>({});

  /**
   * Garantiza que el cold-start solo se ejecute una vez por montaje del hook.
   */
  const initialReplayDoneRef = useRef(false);

  const activeUserId = activeProfile?.localUserId?.trim() ?? "";
  const cloudConfig = useMemo(() => buildActiveCloudConfig(config, activeProfile), [config, activeProfile]);

  const gamesRef = useRef(config?.games);
  gamesRef.current = config?.games;

  const lastActiveUserIdRef = useRef(activeUserId);
  if (lastActiveUserIdRef.current !== activeUserId) {
    lastActiveUserIdRef.current = activeUserId;
    initialReplayDoneRef.current = false;
    lastBroadcastedGameIdRef.current = null;
    prevGameStatusRef.current = {};
  }

  const hostId = cloudConfig?.activeCloudHostUserId?.trim() ?? "";
  const isUsingHostCloud = !!hostId;
  const activeWsBaseUrl = isUsingHostCloud
    ? (cloudConfig?.cloudHostWsBaseUrls?.[hostId]?.trim() ?? "")
    : (cloudConfig?.wsBaseUrl?.trim() ?? "");

  const wsConnectionTargetKey = `${activeUserId}|${hostId}|${activeWsBaseUrl}`;
  const lastWsConnectionTargetKeyRef = useRef<string>("");

  useEffect(() => {
    if (configLoading || profileLoading) {
      return;
    }

    if (!activeUserId || cloudConfig == null || !hasUsableCloudConnection(cloudConfig)) {
      if (lastWsConnectionTargetKeyRef.current !== "") {
        lastWsConnectionTargetKeyRef.current = "";
        invoke("stop_cloud_ws").catch(() => {});
      }
      return;
    }

    if (lastWsConnectionTargetKeyRef.current === wsConnectionTargetKey) {
      return;
    }

    lastWsConnectionTargetKeyRef.current = wsConnectionTargetKey;

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
          // Silencioso: Rust reportará el error de conexión.
        }
      }

      try {
        await invoke("start_cloud_ws");
      } catch {
        // Silencioso: el manager de Rust loguea internamente.
      }

      if (isComponentMounted) {
        unlistenIncoming = await listen<CloudIncomingMessage>("cloud-ws-incoming", (event) => {
          const { type, data } = event.payload;
          if (type === "FRIEND_PLAYING" && data.friendUserId) {
            useGameSessionStore.getState().recordPresence(data.friendUserId, "playing", data.gameId, Date.now());
            queryClient.invalidateQueries({ queryKey: ["cloud-presence"] });
          } else if (type === "PRESENCE_UPDATE" && data.userId && data.status) {
            useGameSessionStore.getState().recordPresence(data.userId, data.status, data.gameId, Date.now());
            queryClient.invalidateQueries({ queryKey: ["cloud-presence"] });
          }
        });
      }
    }

    void setupCloudService();

    return () => {
      isComponentMounted = false;
      unlistenIncoming?.();
    };
  }, [
    wsConnectionTargetKey,
    activeUserId,
    cloudConfig,
    configLoading,
    profileLoading,
    hostId,
    isUsingHostCloud,
    activeWsBaseUrl,
    refetch,
    queryClient,
  ]);

  useEffect(() => {
    if (!activeUserId) return;

    /**
     * TTL del backend: 90 s.
     * Heartbeat cada 45 s = 50 % del TTL, margen suficiente para latencia.
     */
    const BROADCAST_REFRESH_MS = 45_000;

    /**
     * Cooldown mínimo entre dos broadcasts de *stop* para el mismo juego.
     */
    const STOP_BROADCAST_COOLDOWN_MS = 3_000;

    let refreshIntervalId: ReturnType<typeof setInterval> | null = null;
    let unlistenStatus: (() => void) | undefined;

    function resolveGameName(gameId: string): string {
      const gameNode = gamesRef.current?.find((g) => g.id === gameId);
      const baseDisplayName = formatGameDisplayName(gameId);
      const editionLabel = gameNode?.editionLabel?.trim();
      return editionLabel ? `${baseDisplayName} (${editionLabel})` : baseDisplayName;
    }

    /**
     * Broadcast de INICIO de juego.
     *
     * Muestra el overlay en DEV y envía el primer heartbeat al servidor.
     * Solo debe llamarse en la transición `stopped → running`.
     */
    function broadcastGameStart(gameId: string): void {
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

    /**
     * Heartbeat silencioso: renueva el TTL en DynamoDB sin efectos secundarios.
     *
     * NO muestra overlay ni notificaciones. Es el único tipo de broadcast
     * que se envía desde el timer de refresco periódico.
     */
    function refreshGamePresence(gameId: string): void {
      if (!activeUserId) return;

      const gameName = resolveGameName(gameId);

      invoke("send_cloud_broadcast", { gameId, gameName })
        .then(() => queryClient.invalidateQueries({ queryKey: ["cloud-presence"] }))
        .catch(() => {});
      // Sin overlay, sin notificaciones.
    }

    /**
     * Broadcast de FIN de juego (gameId y gameName vacíos = "online").
     */
    function broadcastGameStop(): void {
      if (!activeUserId) return;

      invoke("send_cloud_broadcast", { gameId: "", gameName: "" })
        .then(() => queryClient.invalidateQueries({ queryKey: ["cloud-presence"] }))
        .catch(() => {});
    }

    /**
     * Inicia (o reinicia) el timer de refresco periódico para `gameId`.
     *
     * Usa `refreshGamePresence` (silencioso) en lugar de `broadcastGameStart`
     * para evitar que el overlay aparezca repetidamente.
     *
     * Si `lastBroadcastedGameIdRef` ya no apunta a este juego cuando el
     * intervalo dispara, el timer se auto-cancela.
     */
    function startRefreshTimer(gameId: string): void {
      if (refreshIntervalId !== null) {
        clearInterval(refreshIntervalId);
      }

      refreshIntervalId = setInterval(() => {
        if (lastBroadcastedGameIdRef.current === gameId) {
          refreshGamePresence(gameId);
        } else {
          if (refreshIntervalId !== null) {
            clearInterval(refreshIntervalId);
            refreshIntervalId = null;
          }
        }
      }, BROADCAST_REFRESH_MS);
    }

    function stopRefreshTimer(): void {
      if (refreshIntervalId !== null) {
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
      }
    }

    if (!initialReplayDoneRef.current) {
      initialReplayDoneRef.current = true;

      invoke<Record<string, boolean>>("get_running_games_status")
        .then((currentStatus) => {
          for (const [gameId, isRunning] of Object.entries(currentStatus)) {
            if (isRunning) {
              prevGameStatusRef.current[gameId] = true;
              lastBroadcastedGameIdRef.current = gameId;
              broadcastGameStart(gameId);
              startRefreshTimer(gameId);
            }
          }
        })
        .catch(() => {});
    } else {
      if (lastBroadcastedGameIdRef.current !== null) {
        startRefreshTimer(lastBroadcastedGameIdRef.current);
      }
    }

    /**
     * Reacciona a cambios en el mapa `gameId → isRunning` emitido por Rust.
     *
     * Rust solo emite el evento cuando el mapa cambia, por lo que este
     * listener NO se usa para el refresco periódico (eso lo hace el timer).
     * Su responsabilidad es exclusivamente gestionar transiciones:
     *
     * - `stopped → running`: broadcast inicial + arrancar timer.
     * - `running → stopped`: detener timer + broadcast de stop.
     */
    const setupListener = async () => {
      try {
        unlistenStatus = await listen<Record<string, boolean>>("games-running-status", (event) => {
          const currentStatus = event.payload;
          const prevStatus = prevGameStatusRef.current;
          const now = Date.now();

          for (const [gameId, isRunning] of Object.entries(currentStatus)) {
            const wasRunning = !!prevStatus[gameId];

            if (isRunning && !wasRunning) {
              lastBroadcastedGameIdRef.current = gameId;
              broadcastGameStart(gameId);
              startRefreshTimer(gameId);
            } else if (!isRunning && wasRunning) {
              if (lastBroadcastedGameIdRef.current === gameId) {
                lastBroadcastedGameIdRef.current = null;
                stopRefreshTimer();
              }

              const lastStopAt = stopCooldownByGameRef.current[gameId] ?? 0;
              if (now - lastStopAt >= STOP_BROADCAST_COOLDOWN_MS) {
                stopCooldownByGameRef.current[gameId] = now;
                broadcastGameStop();
              }
            }
          }

          prevGameStatusRef.current = { ...currentStatus };
        });
      } catch {
        // Fallback silencioso: el polling de presencia del backend lo cubre.
      }
    };

    void setupListener();

    return () => {
      unlistenStatus?.();
      stopRefreshTimer();
    };
  }, [activeUserId, queryClient]);
}
