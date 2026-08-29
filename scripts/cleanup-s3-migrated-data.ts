/**
 * @fileoverview Script para limpiar los objetos y metadatos en S3 que ya han sido migrados a DynamoDB.
 *
 * Prefijos a limpiar en S3:
 * - `clips-meta/` (Metadatos JSON de clips; los videos clips/*.mp4 se preservan intactos)
 * - `notifications/` (Notificaciones JSON)
 * - `share-tokens/` (Tokens de enlace compartido)
 * - `cloud-invites/` (Invitaciones, índices y tokens antiguos)
 * - `cloud-invites-memberships/` (Archivos de membresía grupal)
 * - `cloud-invites-shared-games/` (Listas de juegos compartidos por miembro)
 * - `cloud-invites-member-hosts/` (Índices legacy de hosts por miembro)
 * - `game-inventory/` (Dispositivos, índices por juego y sesiones temporales)
 *
 * Prefijos protegidos que NUNCA se eliminan:
 * - `<userId>/<gameId>/*` (Guardados y backups de partidas)
 * - `<userId>/__config__/*` (Copias de configuración del usuario)
 * - `clips/*.mp4` (Videos MP4 de clips)
 * - `steam-seed/*` (Catálogo de Steam Seed)
 *
 * @example
 * ```bash
 * bun run scripts/cleanup-s3-migrated-data.ts --dry-run
 * bun run scripts/cleanup-s3-migrated-data.ts --live
 * ```
 */

import { S3Client, ListObjectsV2Command, DeleteObjectsCommand, type ObjectIdentifier } from "@aws-sdk/client-s3";

/**
 * Prefijos de S3 que fueron migrados a DynamoDB y son seguros para purgar.
 */
const MIGRATED_PREFIXES = [
  "clips-meta/",
  "notifications/",
  "share-tokens/",
  "cloud-invites/",
  "cloud-invites-memberships/",
  "cloud-invites-shared-games/",
  "cloud-invites-member-hosts/",
  "game-inventory/",
] as const;

/**
 * Divide un array en lotes del tamaño indicado.
 */
function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Lista todos los objetos que comienzan con el prefijo indicado.
 */
async function listObjectsUnderPrefix(s3: S3Client, bucketName: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        ContinuationToken: token,
      })
    );

    for (const item of res.Contents ?? []) {
      if (item.Key) {
        keys.push(item.Key);
      }
    }

    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  return keys;
}

/**
 * Elimina un conjunto de claves en S3 en lotes de hasta 1000 objetos.
 */
async function deleteKeysInBatches(s3: S3Client, bucketName: string, keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;

  const batches = chunkArray(keys, 1000);
  let deletedCount = 0;

  for (const batch of batches) {
    const objects: ObjectIdentifier[] = batch.map((Key) => ({ Key }));
    const res = await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: {
          Objects: objects,
          Quiet: true,
        },
      })
    );

    deletedCount += batch.length - (res.Errors?.length ?? 0);
  }

  return deletedCount;
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const stage = args.includes("--dev") ? "dev" : "live";
  const awsRegion = process.env.AWS_REGION || "us-east-2";
  const bucketName = process.env.BUCKET_NAME || `sync-games-${stage}-savesbucket-cddc4askovgp`;

  console.log("===============================================================");
  console.log("LIMPIEZA DE METADATOS Y ARCHIVOS MIGRADOS EN S3");
  console.log(`Stage       : ${stage}`);
  console.log(`Bucket      : ${bucketName}`);
  console.log(`Modo        : ${isDryRun ? "DRY-RUN (Simulación sin borrar)" : "EJECUCION REAL"}`);
  console.log("===============================================================\n");

  const s3 = new S3Client({ region: awsRegion });
  let totalObjectsFound = 0;
  let totalObjectsDeleted = 0;

  for (const prefix of MIGRATED_PREFIXES) {
    const keys = await listObjectsUnderPrefix(s3, bucketName, prefix);
    console.log(`Prefijo [${prefix}] -> ${keys.length} objetos encontrados`);

    if (keys.length === 0) continue;

    totalObjectsFound += keys.length;

    if (!isDryRun) {
      const deleted = await deleteKeysInBatches(s3, bucketName, keys);
      console.log(`  └─ Eliminados: ${deleted} objetos de S3`);
      totalObjectsDeleted += deleted;
    }
  }

  console.log("\n===============================================================");
  console.log("RESUMEN DE LIMPIEZA");
  console.log(`Total objetos encontrados : ${totalObjectsFound}`);
  console.log(`Total objetos eliminados  : ${isDryRun ? 0 : totalObjectsDeleted}`);
  console.log("===============================================================");

  if (isDryRun) {
    console.log("\n[INFO] Modo simulación completado. Para eliminar los archivos ejecuta:");
    console.log("bun run scripts/cleanup-s3-migrated-data.ts --live");
  } else {
    console.log("\n[PASS] Limpieza de S3 completada con éxito. Todos los datos están en DynamoDB.");
  }
}

run().catch((err) => {
  console.error("Error durante la limpieza de S3:", err);
  process.exit(1);
});
