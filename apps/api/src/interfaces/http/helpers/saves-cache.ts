import type { ListBackupsOutput } from "@application/use-cases/ListBackupsUseCase";
import { invalidateListSavesByGameCache } from "@application/use-cases/ListSavesUseCase";
import { TtlCache } from "@shared/ttlCache";
import type { SummaryEtagItem } from "@shared/etag";

const savesSummaryCache = new TtlCache<string, SummaryEtagItem[]>({ ttlMs: 2_000, maxEntries: 200 });
const backupsListCache = new TtlCache<string, ListBackupsOutput>({ ttlMs: 10_000, maxEntries: 300 });

export function getCachedSavesSummary(userId: string): SummaryEtagItem[] | null {
  return savesSummaryCache.get(userId);
}

export function cacheSavesSummary(userId: string, summary: SummaryEtagItem[]): void {
  savesSummaryCache.set(userId, summary);
}

export function getCachedBackups(storageUserId: string, gameId: string): ListBackupsOutput | null {
  return backupsListCache.get(`${storageUserId}::${gameId.trim()}`);
}

export function cacheBackups(storageUserId: string, gameId: string, backups: ListBackupsOutput): void {
  backupsListCache.set(`${storageUserId}::${gameId.trim()}`, backups);
}

export function invalidateSavesCaches(userId: string, gameId?: string): void {
  savesSummaryCache.delete(userId);
  invalidateListSavesByGameCache(userId, gameId);
}

export function invalidateBackupsCache(storageUserId: string, gameId: string): void {
  backupsListCache.delete(`${storageUserId}::${gameId.trim()}`);
}
