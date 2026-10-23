import { check } from "k6";
import type { Options } from "k6/options";

interface LoadProfile {
  maxVUs: number;
  stages: NonNullable<Options["stages"]>;
  thresholds: NonNullable<Options["thresholds"]>;
}

const profiles = {
  smoke: {
    maxVUs: 1,
    stages: [{ duration: "30s", target: 1 }],
    thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<1000"] },
  },
  load: {
    maxVUs: 10,
    stages: [
      { duration: "1m", target: 10 },
      { duration: "3m", target: 10 },
      { duration: "1m", target: 0 },
    ],
    thresholds: { http_req_failed: ["rate<0.01"], http_req_duration: ["p(95)<750"] },
  },
  stress: {
    maxVUs: 100,
    stages: [
      { duration: "1m", target: 20 },
      { duration: "2m", target: 50 },
      { duration: "2m", target: 100 },
      { duration: "1m", target: 0 },
    ],
    thresholds: { http_req_failed: ["rate<0.05"], http_req_duration: ["p(95)<1500"] },
  },
} satisfies Record<string, LoadProfile>;

type ProfileName = keyof typeof profiles;
const requestedProfile = __ENV.TEST_PROFILE || "smoke";
function isProfileName(value: string): value is ProfileName {
  return Object.hasOwn(profiles, value);
}
if (!isProfileName(requestedProfile)) {
  throw new Error(`Unknown TEST_PROFILE '${requestedProfile}'. Use smoke, load, or stress.`);
}
export const profile = requestedProfile;
const selected = profiles[profile];
export const maxVUs = selected.maxVUs;

export const options: Options = {
  scenarios: {
    mixed_api_workload: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: selected.stages,
    },
  },
  thresholds: selected.thresholds,
  userAgent: "SaveCloud-k6/1.0",
};

export const baseUrl = (__ENV.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
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
