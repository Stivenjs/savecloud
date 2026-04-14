import { S3Client } from "@aws-sdk/client-s3";
import type { Context } from "aws-lambda";
import { DEFAULT_STEAM_FILTERS } from "@interfaces/lambda/steam-seed/layout";
import { pickOwnerIdAuto } from "@interfaces/lambda/steam-seed/owners";
import { runSteamSeedTick } from "@interfaces/lambda/steam-seed/run";

/**
 * Entry point del worker `steamSeedWorker`.
 *
 * - `event.ownerId` (opcional): fuerza el owner a procesar (útil para invocación manual).
 * - En ejecución programada sin owner, hace auto-discovery + round-robin.
 */
export async function handler(_event: unknown, _context: Context): Promise<Record<string, unknown>> {
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
    const s3 = new S3Client({ region });

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

    const result = await runSteamSeedTick({ s3, bucket, seedPrefix });

    console.log(
      JSON.stringify({
        msg: "steam-seed.done",
        requestId,
        seedPrefix: result.seedPrefix,
        reason: result.reason ?? null,
        priorityChangedDetected: result.priorityChangedDetected ?? false,
        wroteBatchKey: result.wroteBatchKey ?? null,
        done: result.done,
        backoffUntil: result.stateAfter.backoffUntil,
        catalogComplete: result.stateAfter.catalogComplete,
        totals: result.stateAfter.totals,
      })
    );

    return {
      ok: true,
      seedPrefix: result.seedPrefix,
      reason: result.reason,
      priorityChangedDetected: result.priorityChangedDetected ?? false,
      wroteBatchKey: result.wroteBatchKey,
      done: result.done,
      totals: result.stateAfter.totals,
      // Campo útil para debugging rápido de configuración.
      steamFiltersEffective: process.env.STEAM_FILTERS ?? DEFAULT_STEAM_FILTERS,
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
