import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { STEAM_SEED_MANIFEST_PREFIX, STEAM_SEED_MANIFEST_SUFFIX } from "@shared/steam-seed-layout";

/**
 * Lista los propietarios que tienen al menos una parte de manifiesto válida.
 *
 * @param s3 - Cliente S3 configurado para el almacenamiento de Steam Seed.
 * @param bucket - Bucket que contiene el catálogo.
 * @param basePrefix - Prefijo raíz del catálogo, sin barras externas.
 * @returns Identificadores ordenados de los owners con manifiestos.
 */
export async function listSteamSeedOwnerIdsWithManifest(
  s3: S3Client,
  bucket: string,
  basePrefix: string
): Promise<string[]> {
  const ownerIds: string[] = [];
  const rootPrefix = `${basePrefix}/`;
  let continuationToken: string | undefined;

  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: rootPrefix,
        Delimiter: "/",
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        MaxKeys: 1000,
      })
    );

    for (const commonPrefix of page.CommonPrefixes ?? []) {
      const prefix = commonPrefix.Prefix;
      if (!prefix?.startsWith(rootPrefix)) continue;
      const ownerId = prefix.slice(rootPrefix.length).replace(/\/$/, "");
      if (ownerId) ownerIds.push(ownerId);
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  const ownersWithManifest: string[] = [];
  for (const ownerId of ownerIds.sort()) {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: `${rootPrefix}${ownerId}/${STEAM_SEED_MANIFEST_PREFIX}`,
        MaxKeys: 1,
      })
    );
    if (page.Contents?.some((object) => object.Key?.endsWith(STEAM_SEED_MANIFEST_SUFFIX))) {
      ownersWithManifest.push(ownerId);
    }
  }

  return ownersWithManifest;
}
