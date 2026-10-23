import http from "k6/http";
import { group } from "k6";
import { apiHeaders, httpPost, parseJson } from "@/helpers";
import { baseUrl, assertStatus } from "@/config";

interface SaveRecord {
  gameId: string;
  key: string;
  filename: string;
}

interface GameSummary {
  gameId: string;
}

interface ClipRecord {
  clipId: string;
}

/**
 * Simula la navegación habitual por la biblioteca y el panel principal.
 *
 * Consulta guardados, resumen, detalles del juego y URLs de descarga; de forma
 * ocasional también revisa papelera e invitaciones pendientes.
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

    const savesBody = parseJson<SaveRecord[]>(saves, "saves list");
    const summaries = parseJson<GameSummary[]>(summary, "saves summary");
    const selectedSave =
      savesBody.length > 0 ? savesBody[Math.floor(Math.random() * savesBody.length)] : undefined;
    const selectedGame =
      selectedSave?.gameId ??
      (summaries.length > 0 ? summaries[Math.floor(Math.random() * summaries.length)].gameId : undefined);

    if (selectedGame) {
      const backups = http.get(`${baseUrl}/saves/backups?gameId=${encodeURIComponent(selectedGame)}`, {
        headers: apiHeaders(),
        tags: { endpoint: "saves-backups" },
      });
      assertStatus(backups, 200, "game backups");
    }

    if (selectedSave) {
      const downloadUrl = httpPost(
        `${baseUrl}/saves/download-url`,
        { gameId: selectedSave.gameId, key: selectedSave.key },
        "download-url"
      );
      assertStatus(downloadUrl, 200, "download URL");
    }

    // La vista inicial también suele consultar papelera e invitaciones.
    if (Math.random() < 0.25) {
      const trash = http.get(`${baseUrl}/trash`, {
        headers: apiHeaders(),
        tags: { endpoint: "trash-list" },
      });
      assertStatus(trash, 200, "trash list");

      const invites = http.get(`${baseUrl}/invites/pending`, {
        headers: apiHeaders(),
        tags: { endpoint: "pending-invites" },
      });
      assertStatus(invites, 200, "pending invites");
    }

    if (Math.random() < 0.3) {
      const notifications = http.get(`${baseUrl}/notifications?limit=20`, {
        headers: apiHeaders(),
        tags: { endpoint: "notifications-list" },
      });
      assertStatus(notifications, 200, "notifications list");
    }

    if (Math.random() < 0.1) {
      const memberships = http.get(`${baseUrl}/invites/memberships`, {
        headers: apiHeaders(),
        tags: { endpoint: "cloud-memberships" },
      });
      assertStatus(memberships, 200, "cloud memberships");
    }

    if (Math.random() < 0.15) {
      const clipsResponse = http.get(`${baseUrl}/clips`, {
        headers: apiHeaders(),
        tags: { endpoint: "clips-list" },
      });
      assertStatus(clipsResponse, 200, "clips list");

      const { clips } = parseJson<{ clips: ClipRecord[] }>(clipsResponse, "clips list");
      if (clips.length > 0) {
        const selectedClip = clips[Math.floor(Math.random() * clips.length)];
        const clipDetails = http.get(`${baseUrl}/api/clips/${encodeURIComponent(selectedClip.clipId)}`, {
          tags: { endpoint: "clip-details" },
        });
        assertStatus(clipDetails, 200, "clip details");
      }
    }
  });
}
