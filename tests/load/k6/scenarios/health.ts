import http from "k6/http";
import { check } from "k6";
import { baseUrl } from "@/config";

/**
 * Confirms the API is reachable once before load starts.
 * Keeping this probe in setup avoids making the health endpoint's rate limit
 * the bottleneck for business endpoint scenarios.
 */
export function healthSetupCheck(): void {
  const response = http.get(`${baseUrl}/health`, { tags: { endpoint: "health-setup" } });
  const healthy = check(response, { "health endpoint returns 200": (res) => res.status === 200 });
  if (!healthy) throw new Error(`API health check failed with status ${response.status}.`);
}
