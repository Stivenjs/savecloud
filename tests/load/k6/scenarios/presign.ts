import http from "k6/http";
import { check, group } from "k6";
import { httpPost, parseJson } from "@/helpers";
import { baseUrl, assertStatus } from "@/config";

interface BatchUploadUrlsResponse {
  urls: Array<{ uploadUrl: string; key: string; gameId: string; filename: string }>;
}

/**
 * Exercises single and batch presigned upload URL generation without storing
 * any objects in S3.
 */
export function presignScenario(): void {
  group("presigned upload URLs", () => {
    const single = httpPost(
      `${baseUrl}/saves/upload-url`,
      { gameId: "k6-presign-probe", filename: "single.sav" },
      "upload-url"
    );
    assertStatus(single, 200, "single upload URL");
    check(single, {
      "single upload URL contains a signed URL": (response) => {
        const result = parseJson<{ uploadUrl: string; key: string }>(response, "single upload URL");
        return result.uploadUrl.startsWith("http") && result.key.length > 0;
      },
    });

    const batch = httpPost(
      `${baseUrl}/saves/upload-urls`,
      {
        items: [
          { gameId: "k6-presign-probe", filename: "batch-1.sav" },
          { gameId: "k6-presign-probe", filename: "batch-2.sav" },
        ],
      },
      "upload-urls-batch"
    );
    assertStatus(batch, 200, "batch upload URLs");
    check(batch, {
      "batch upload returns two signed URLs": (response) =>
        parseJson<BatchUploadUrlsResponse>(response, "batch upload URLs").urls.length === 2,
    });
  });
}
