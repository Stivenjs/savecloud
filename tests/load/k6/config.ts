import { check } from "k6";
import type { Options } from "k6/options";

interface LoadProfile {
  maxVUs: number;
  executor: "ramping-vus" | "ramping-arrival-rate";
  stages: NonNullable<Options["stages"]>;
  thresholds: NonNullable<Options["thresholds"]>;
  startRate?: number;
  preAllocatedVUs?: number;
}

const profiles = {
  smoke: {
    maxVUs: 1,
    executor: "ramping-vus",
    stages: [{ duration: "30s", target: 1 }],
    thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<1000"] },
  },
  load: {
    maxVUs: 10,
    executor: "ramping-vus",
    stages: [
      { duration: "1m", target: 10 },
      { duration: "3m", target: 10 },
      { duration: "1m", target: 0 },
    ],
    thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<750"] },
  },
  stress: {
    maxVUs: 100,
    executor: "ramping-vus",
    stages: [
      { duration: "1m", target: 20 },
      { duration: "2m", target: 50 },
      { duration: "2m", target: 100 },
      { duration: "1m", target: 0 },
    ],
    thresholds: { http_req_failed: ["rate<0.05"], http_req_duration: ["p(95)<1500"] },
  },
  capacity: {
    maxVUs: 250,
    executor: "ramping-arrival-rate",
    startRate: 5,
    preAllocatedVUs: 50,
    stages: [
      { duration: "30s", target: 10 },
      { duration: "1m", target: 15 },
      { duration: "1m", target: 20 },
      { duration: "1m", target: 25 },
      { duration: "30s", target: 0 },
    ],
    thresholds: {
      http_req_failed: ["rate<0.05"],
      http_req_duration: ["p(95)<1500"],
      ws_handshake_success: ["rate>0.99"],
      ws_pong_success: ["rate>0.99"],
      ws_pong_latency_ms: ["p(95)<500"],
    },
  },
  ws: {
    maxVUs: 10,
    executor: "ramping-vus",
    stages: [
      { duration: "1m", target: 10 },
      { duration: "3m", target: 10 },
      { duration: "1m", target: 0 },
    ],
    thresholds: {
      ws_handshake_success: ["rate>0.99"],
      ws_pong_success: ["rate>0.99"],
      ws_pong_latency_ms: ["p(95)<500"],
    },
  },
} satisfies Record<string, LoadProfile>;

type ProfileName = keyof typeof profiles;
const requestedProfile = __ENV.TEST_PROFILE || "smoke";
function isProfileName(value: string): value is ProfileName {
  return Object.hasOwn(profiles, value);
}
if (!isProfileName(requestedProfile)) {
  throw new Error(`Unknown TEST_PROFILE '${requestedProfile}'. Use smoke, load, stress, or capacity.`);
}
export const profile = requestedProfile;
const selected = profiles[profile];
export const maxVUs = selected.maxVUs;

const workloadScenario =
  selected.executor === "ramping-arrival-rate"
    ? {
        executor: selected.executor,
        startRate: selected.startRate ?? 1,
        timeUnit: "1s",
        preAllocatedVUs: selected.preAllocatedVUs ?? 1,
        maxVUs: selected.maxVUs,
        stages: selected.stages,
      }
    : {
        executor: selected.executor,
        startVUs: 1,
        stages: selected.stages,
      };

const scenarios: NonNullable<Options["scenarios"]> =
  profile === "capacity"
    ? {
        api_capacity: { ...workloadScenario, exec: "default" },
        websocket_presence: {
          executor: "constant-vus",
          vus: 25,
          duration: "4m",
          gracefulStop: "30s",
          exec: "websocketLoad",
        },
      }
    : profile === "ws"
      ? { websocket_connections: { ...workloadScenario, exec: "websocketLoad" } }
      : { mixed_api_workload: workloadScenario };

export const options: Options = {
  scenarios,
  thresholds: selected.thresholds,
  userAgent: "SaveCloud-k6/1.0",
};

export const baseUrl = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
export const wsBaseUrl = (__ENV.WS_BASE_URL || baseUrl)
  .replace(/^https:/, "wss:")
  .replace(/^http:/, "ws:")
  .replace(/\/$/, "");
export const wsEndpoint = __ENV.WS_BASE_URL?.trim() || `${wsBaseUrl}/ws`;
export const apiKey = __ENV.SYNC_GAMES_API_KEY || "";
const configuredUserIds = (__ENV.USER_IDS || "")
  .split(",")
  .map((userId) => userId.trim())
  .filter(Boolean)
  .filter((userId, index, ids) => ids.indexOf(userId) === index);
const singleUserId = (__ENV.USER_ID || "").trim();
const userIdPrefix = (__ENV.USER_ID_PREFIX || "savecloud-k6-user").trim() || "savecloud-k6-user";
export const userIds =
  configuredUserIds.length > 0
    ? configuredUserIds
    : singleUserId
      ? [singleUserId]
      : Array.from({ length: maxVUs }, (_, index) => `${userIdPrefix}-${String(index + 1).padStart(3, "0")}`);

/** Asigna una identidad estable a cada VU y permite varios dispositivos por cuenta. */
export function userIdForVu(vu: number): string {
  return userIds[(vu - 1) % userIds.length] || "";
}

/**
 * Comprueba el estado y la latencia de una respuesta HTTP.
 *
 * @param response - Respuesta HTTP devuelta por k6.
 * @param expected - Código de estado esperado.
 * @param label - Nombre de la operación en el informe.
 */
export function assertStatus(
  response: { status: number; timings: { duration: number } },
  expected: number,
  label: string
): void {
  check(response, {
    [`${label}: status ${expected}`]: (res) => res.status === expected,
    [`${label}: response under 2s`]: (res) => res.timings.duration < 2000,
  });
}
