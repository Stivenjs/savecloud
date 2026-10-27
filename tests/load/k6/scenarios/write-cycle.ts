import http from "k6/http";
import { check, group, sleep } from "k6";
import type { LoadTestRun } from "@/helpers";
import { apiHeaders, httpPost, parseJson, permanentlyDeleteGame } from "@/helpers";
import { baseUrl, assertStatus } from "@/config";

interface UploadUrlResponse {
  uploadUrl: string;
  key: string;
}

interface SaveRecord {
  gameId: string;
  filename: string;
}

const INDEX_VISIBILITY_TIMEOUT_SECONDS = 5;
const INDEX_POLL_INTERVAL_SECONDS = 0.2;

/**
 * Ejecuta una carga aislada y espera la indexación asíncrona antes de borrar el objeto.
 *
 * @param run - Identificadores únicos creados durante la preparación de k6.
 */
export function writeCycleScenario(run: LoadTestRun): void {
  const gameId = `k6-${run.runId}-${__VU}`;
  const filename = `iteration-${__ITER}-${Date.now()}.sav`;

  group("temporary save upload and cleanup", () => {
    try {
      const uploadUrlResponse = httpPost(`${baseUrl}/saves/upload-url`, { gameId, filename }, "upload-url");
      assertStatus(uploadUrlResponse, 200, "upload URL");

      const { uploadUrl } = parseJson<UploadUrlResponse>(uploadUrlResponse, "upload URL");
      const uploadResponse = http.put(uploadUrl, "k6 temporary save payload\n", {
        headers: { "content-type": "application/octet-stream" },
        tags: { endpoint: "s3-save-upload" },
      });
      assertStatus(uploadResponse, 200, "S3 save upload");

      let saveIsVisible = false;
      const deadline = Date.now() + INDEX_VISIBILITY_TIMEOUT_SECONDS * 1000;
      while (!saveIsVisible && Date.now() < deadline) {
        const listResponse = http.get(`${baseUrl}/saves?gameId=${encodeURIComponent(gameId)}`, {
          headers: apiHeaders(),
          tags: { endpoint: "saves-list-after-upload" },
        });
        assertStatus(listResponse, 200, "save list after upload");
        saveIsVisible = parseJson<SaveRecord[]>(listResponse, "save list after upload").some(
          (save) => save.gameId === gameId && save.filename === filename
        );
        if (!saveIsVisible) sleep(INDEX_POLL_INTERVAL_SECONDS);
      }

      check(saveIsVisible, {
        "uploaded save is visible in the library": (visible) => visible,
      });
    } finally {
      permanentlyDeleteGame(gameId, "temporary-save-cleanup");
    }
  });
}
