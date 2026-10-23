import http from "k6/http";
import { group } from "k6";
import { apiKey, assertStatus, baseUrl } from "@/config";

export function authenticatedScenario() {
  if (!apiKey) throw new Error("Set API_KEY to run authenticated scenarios.");

  group("authenticated saves summary", () => {
    const response = http.get(`${baseUrl}/saves/summary`, {
      headers: { "x-api-key": apiKey },
      tags: { endpoint: "saves-summary" },
    });
    assertStatus(response, 200, "saves summary");
  });
}
