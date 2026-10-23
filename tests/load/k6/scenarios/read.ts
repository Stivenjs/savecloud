import http from "k6/http";
import { group } from "k6";
import { apiHeaders } from "@/helpers";
import { baseUrl, assertStatus } from "@/config";

/**
 * Exercises the common read path used to populate the library and dashboard.
 *
 * Requests both the per-file save list and its compact game summary.
 */
export function readScenario(): void {
  group("library read", () => {
    const saves = http.get(`${baseUrl}/saves`, {
      headers: apiHeaders(),
      tags: { endpoint: "saves-list" },
    });
    assertStatus(saves, 200, "saves list");

    const summary = http.get(`${baseUrl}/saves/summary`, {
      headers: apiHeaders(),
      tags: { endpoint: "saves-summary" },
    });
    assertStatus(summary, 200, "saves summary");
  });
}
