import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import ws from "k6/ws";
import { apiKey, userIdForVu, wsEndpoint } from "@/config";

const CONNECTION_DURATION_MS = 60_000;
export const CAPACITY_WEBSOCKET_DURATION_MS = 4 * 60_000;
const PING_INTERVAL_MS = 25_000;
const GAME_HEARTBEAT_INTERVAL_MS = 45_000;
const PONG_TIMEOUT_MS = 5_000;
const PLAYING_VU_MODULO = 5;
const PLAYING_GAME = { gameId: "730", gameName: "Counter-Strike 2" };

const handshakeSuccess = new Rate("ws_handshake_success");
const pongSuccess = new Rate("ws_pong_success");
const pongLatency = new Trend("ws_pong_latency_ms", true);
const pingsSent = new Counter("ws_pings_sent");
const pongsReceived = new Counter("ws_pongs_received");
const socketErrors = new Counter("ws_socket_errors");
const activityEventsSent = new Counter("ws_activity_events_sent");

/** Mantiene un socket por VU, envía tramas de control Ping y mide sus Pong. */
export function webSocketScenario(connectionDurationMs = CONNECTION_DURATION_MS): void {
  if (!apiKey) throw new Error("Configura SYNC_GAMES_API_KEY para ejecutar el escenario WebSocket.");

  const userId = userIdForVu(__VU);
  const deviceId = `k6-ws-device-${__VU}`;
  const query =
    `userId=${encodeURIComponent(userId)}` +
    `&apiKey=${encodeURIComponent(apiKey)}` +
    `&deviceId=${encodeURIComponent(deviceId)}`;
  const response = ws.connect(`${wsEndpoint}?${query}`, { tags: { endpoint: "websocket" } }, (socket) => {
    let pendingPongAt: number | null = null;
    let isPlaying = __VU % PLAYING_VU_MODULO === 0;

    const sendGameState = (gameId: string, gameName: string, event: string): void => {
      socket.send(JSON.stringify({ action: "broadcast", broadcasterUserId: userId, gameId, gameName }));
      activityEventsSent.add(1, { event });
    };

    socket.on("open", () => {
      if (isPlaying) {
        sendGameState(PLAYING_GAME.gameId, PLAYING_GAME.gameName, "start");
        socket.setInterval(() => {
          if (isPlaying) {
            sendGameState(PLAYING_GAME.gameId, PLAYING_GAME.gameName, "heartbeat");
          }
        }, GAME_HEARTBEAT_INTERVAL_MS);
      }

      socket.setInterval(() => {
        if (pendingPongAt !== null) return;

        pendingPongAt = Date.now();
        pingsSent.add(1);
        socket.ping();

        socket.setTimeout(() => {
          if (pendingPongAt === null) return;
          pongSuccess.add(false);
          pendingPongAt = null;
        }, PONG_TIMEOUT_MS);
      }, PING_INTERVAL_MS);

      socket.setTimeout(() => {
        if (!isPlaying) {
          socket.close(1000);
          return;
        }

        isPlaying = false;
        sendGameState("", "", "stop");
        socket.setTimeout(() => socket.close(1000), 1_000);
      }, connectionDurationMs);
    });

    socket.on("pong", () => {
      if (pendingPongAt === null) return;

      pongLatency.add(Date.now() - pendingPongAt);
      pongsReceived.add(1);
      pongSuccess.add(true);
      pendingPongAt = null;
    });

    socket.on("error", () => socketErrors.add(1));
  });

  const upgraded = response.status === 101;
  handshakeSuccess.add(upgraded);
  check(response, { "websocket handshake upgraded": () => upgraded });
}
