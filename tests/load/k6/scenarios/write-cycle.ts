import http from "k6/http";
import { check, group } from "k6";
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

/**
 * Performs a complete, isolated save upload cycle: request a presigned URL,
 * PUT a tiny object to S3, read it through the API, and permanently delete it.
 *
 * @param run - Unique identifiers created in the k6 setup lifecycle.
 */
export function writeCycleScenario(run: LoadTestRun): void {
  const gameId = `k6-${run.runId}-${__VU}`;
  const filename = `iteration-${__ITER}-${Date.now()}.sav`;

  group("temporary save upload and cleanup", () => {
    try {
      const uploadUrlResponse = httpPost(
        `${baseUrl}/saves/upload-url`,
        { gameId, filename },
        "upload-url"
      );
      assertStatus(uploadUrlResponse, 200, "upload URL");

      const { uploadUrl } = parseJson<UploadUrlResponse>(uploadUrlResponse, "upload URL");
      const uploadResponse = http.put(uploadUrl, "k6 temporary save payload\n", {
        headers: { "content-type": "application/octet-stream" },
        tags: { endpoint: "s3-save-upload" },
      });
      assertStatus(uploadResponse, 200, "S3 save upload");

      const listResponse = http.get(`${baseUrl}/saves?gameId=${encodeURIComponent(gameId)}`, {
        headers: apiHeaders(),
        tags: { endpoint: "saves-list-after-upload" },
      });
      assertStatus(listResponse, 200, "save list after upload");
      check(listResponse, {
        "uploaded save is visible in the library": (response) =>
          parseJson<SaveRecord[]>(response, "save list after upload").some(
            (save) => save.gameId === gameId && save.filename === filename
          ),
      });
    } finally {
      permanentlyDeleteGame(gameId, "temporary-save-cleanup");
    }
  });
}
