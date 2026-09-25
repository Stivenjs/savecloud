import { createS3Client } from "@infrastructure/factories/storageFactory";
import type { Context } from "aws-lambda";
import { DEFAULT_STEAM_FILTERS } from "@interfaces/lambda/steam-seed/layout";
import { pickOwnerIdAuto } from "@interfaces/lambda/steam-seed/owners";
import { runSteamSeedTick } from "@interfaces/lambda/steam-seed/run";
import { runReviewsTick } from "@interfaces/lambda/steam-seed/run_reviews";

/**
 * Entry point del worker `steamSeedWorker`.
 *
 * - `event.ownerId` (opcional): fuerza el owner a procesar (útil para invocación manual).
 * - En ejecución programada sin owner, hace auto-discovery + round-robin.
 *
 * Cada invocación ejecuta dos ticks secuenciales:
 *   1. Tick de detalles de apps  (comportamiento existente, sin cambios)
 *   2. Tick de reseñas           (nuevo — itera sobre processed_appids.json)
 *
 * Ambos ticks son independientes: si uno está en backoff o completo, el otro
 * continúa con normalidad. Los errores del tick de reseñas se registran pero NO
 * provocan que el Lambda lance una excepción — el progreso de detalles nunca es
 * bloqueado por las reseñas.
 */
export async function handler(_event: unknown, _context?: Partial<Context>): Promise<Record<string, unknown>> {
  const requestId =
    typeof _context === "object" && _context !== null && "awsRequestId" in _context
      ? String((_context as { awsRequestId?: unknown }).awsRequestId ?? "")
      : "";

  try {
    const bucket = process.env.BUCKET_NAME?.trim();
    if (!bucket) {
      console.error("[steam-seed] BUCKET_NAME missing");
      return { ok: false, error: "BUCKET_NAME missing" };
    }

    const region = process.env.AWS_REGION ?? "us-east-2";
    const s3 = createS3Client();

    const basePrefix = (process.env.STEAM_SEED_PREFIX ?? "steam-seed").replace(/\/$/, "");
    const ownerIdFromEvent =
      typeof _event === "object" &&
      _event !== null &&
      "ownerId" in _event &&
      typeof (_event as { ownerId?: unknown }).ownerId === "string"
        ? (_event as { ownerId: string }).ownerId.trim()
        : "";

    const ownerIdAuto = ownerIdFromEvent ? "" : (await pickOwnerIdAuto(s3, bucket, basePrefix)) || "";
    const ownerId = ownerIdFromEvent || ownerIdAuto;

    // Prefijo por owner si existe, o prefijo base para modo legacy.
    const seedPrefix = ownerId ? `${basePrefix}/${ownerId}` : basePrefix;

    console.log(
      JSON.stringify({
        msg: "steam-seed.start",
        requestId,
        region,
        bucket,
        basePrefix,
        ownerIdFromEvent: Boolean(ownerIdFromEvent),
        ownerIdSelected: ownerId || null,
        seedPrefix,
      })
    );

    const detailsResult = await runSteamSeedTick({ s3, bucket, seedPrefix });

    console.log(
      JSON.stringify({
        msg: "steam-seed.done",
        requestId,
        seedPrefix: detailsResult.seedPrefix,
        reason: detailsResult.reason ?? null,
        priorityChangedDetected: detailsResult.priorityChangedDetected ?? false,
        wroteBatchKey: detailsResult.wroteBatchKey ?? null,
        done: detailsResult.done,
        backoffUntil: detailsResult.stateAfter.backoffUntil,
        catalogComplete: detailsResult.stateAfter.catalogComplete,
        totals: detailsResult.stateAfter.totals,
      })
    );

    let reviewsResult: Awaited<ReturnType<typeof runReviewsTick>> | null = null;
    try {
      reviewsResult = await runReviewsTick({ s3, bucket, seedPrefix });

      console.log(
        JSON.stringify({
          msg: "steam-reviews.done",
          requestId,
          seedPrefix: reviewsResult.seedPrefix,
          reason: reviewsResult.reason ?? null,
          wroteBatchKey: reviewsResult.wroteBatchKey ?? null,
          done: reviewsResult.done,
          backoffUntil: reviewsResult.stateAfter.backoffUntil,
          offset: reviewsResult.stateAfter.offset,
          totals: reviewsResult.stateAfter.totals,
        })
      );
    } catch (reviewsErr) {
      console.error(
        JSON.stringify({
          msg: "steam-reviews.error",
          requestId,
          errorName: reviewsErr instanceof Error ? reviewsErr.name : typeof reviewsErr,
          errorMessage: reviewsErr instanceof Error ? reviewsErr.message : String(reviewsErr),
          errorStack: reviewsErr instanceof Error ? reviewsErr.stack : undefined,
        })
      );
    }

    return {
      ok: true,
      seedPrefix: detailsResult.seedPrefix,
      reason: detailsResult.reason,
      priorityChangedDetected: detailsResult.priorityChangedDetected ?? false,
      wroteBatchKey: detailsResult.wroteBatchKey,
      done: detailsResult.done,
      totals: detailsResult.stateAfter.totals,
      steamFiltersEffective: process.env.STEAM_FILTERS ?? DEFAULT_STEAM_FILTERS,
      reviews: reviewsResult
        ? {
            reason: reviewsResult.reason,
            wroteBatchKey: reviewsResult.wroteBatchKey,
            done: reviewsResult.done,
            offset: reviewsResult.stateAfter.offset,
            totals: reviewsResult.stateAfter.totals,
          }
        : null,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: "steam-seed.error",
        requestId,
        errorName: err instanceof Error ? err.name : typeof err,
        errorMessage: err instanceof Error ? err.message : String(err),
        errorStack: err instanceof Error ? err.stack : undefined,
      })
    );
    throw err;
  }
}
