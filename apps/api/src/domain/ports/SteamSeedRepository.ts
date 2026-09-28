/** Define el acceso al catálogo Steam sembrado en almacenamiento de objetos. */
export interface SteamSeedRepository {
  getManifestUploadUrl(ownerId: string, partIndex: number): Promise<{ uploadUrl: string; key: string }>;
  getPriorityUploadUrl(ownerId: string): Promise<{ uploadUrl: string; key: string }>;
  getPriorityDownloadUrl(ownerId: string): Promise<string>;
  getBatchDownloadUrl(ownerId: string, key: string): Promise<string>;
  getBatchDownloadUrl(ownerId: string, keys: string[]): Promise<{ key: string; url: string | null; error?: string }[]>;
  resetState(ownerId: string): Promise<void>;
  getSteamSeedStatus(ownerId: string): Promise<{
    lastBatchKey: string | null;
    batchSeq: number;
    catalogComplete: boolean;
  }>;
  getSteamReviewsSeedStatus(ownerId: string): Promise<{
    lastBatchKey: string | null;
    batchSeq: number;
    offset: number;
    processed: number;
    ok: number;
    notFound: number;
    httpErrors: number;
  }>;
  getWorkerControl(ownerId: string): Promise<{ paused: boolean; updatedAt: string | null }>;
  setWorkerPaused(ownerId: string, paused: boolean): Promise<{ paused: boolean; updatedAt: string | null }>;
  listBatchKeys(ownerId: string, maxKeys?: number, cursor?: string): Promise<{ keys: string[]; nextCursor?: string }>;
  listReviewBatchKeys(
    ownerId: string,
    maxKeys?: number,
    cursor?: string
  ): Promise<{
    keys: string[];
    nextCursor?: string;
  }>;
}
