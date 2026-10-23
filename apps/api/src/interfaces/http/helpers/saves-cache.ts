import type { ListBackupsOutput } from "@application/use-cases/ListBackupsUseCase";
import { invalidateListSavesByGameCache } from "@application/use-cases/ListSavesUseCase";
import { TtlCache } from "@shared/ttlCache";
import type { SummaryEtagItem } from "@shared/etag";

const savesSummaryCache = new TtlCache<string, SummaryEtagItem[]>({ ttlMs: 2_000, maxEntries: 200 });
const backupsListCache = new TtlCache<string, ListBackupsOutput>({ ttlMs: 10_000, maxEntries: 300 });
const savesSummaryInFlight = new Map<string, { promise: Promise<SummaryEtagItem[]>; invalidated: boolean }>();

export async function getOrLoadSavesSummary(
  userId: string,
  loader: () => Promise<SummaryEtagItem[]>
): Promise<SummaryEtagItem[]> {
  const cached = savesSummaryCache.get(userId);
  if (cached) return cached;

  const pending = savesSummaryInFlight.get(userId);
  if (pending) return pending.promise;

  const request = { promise: Promise.resolve([] as SummaryEtagItem[]), invalidated: false };
  request.promise = Promise.resolve().then(loader);
  savesSummaryInFlight.set(userId, request);

  try {
    const summary = await request.promise;
    if (!request.invalidated) savesSummaryCache.set(userId, summary);
    return summary;
  } finally {
    if (savesSummaryInFlight.get(userId) === request) savesSummaryInFlight.delete(userId);
  }
}

export function getCachedBackups(storageUserId: string, gameId: string): ListBackupsOutput | null {
  return backupsListCache.get(`${storageUserId}::${gameId.trim()}`);
}

export function cacheBackups(storageUserId: string, gameId: string, backups: ListBackupsOutput): void {
  backupsListCache.set(`${storageUserId}::${gameId.trim()}`, backups);
}

export function invalidateSavesCaches(userId: string, gameId?: string): void {
  savesSummaryCache.delete(userId);
  const pendingSummary = savesSummaryInFlight.get(userId);
  if (pendingSummary) pendingSummary.invalidated = true;
  invalidateListSavesByGameCache(userId, gameId);
}

export function invalidateBackupsCache(storageUserId: string, gameId: string): void {
  backupsListCache.delete(`${storageUserId}::${gameId.trim()}`);
}
