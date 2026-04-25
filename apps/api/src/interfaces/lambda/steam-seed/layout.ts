/**
 * Objetos bajo `STEAM_SEED_PREFIX` (p.ej. `steam-seed/` en el bucket de guardados).
 * Ver docs/steam-seed.md.
 */
export const STEAM_SEED_STATE_KEY = "state.json";
export const STEAM_SEED_PRIORITY_KEY = "priority_appids.jsonl";
export const STEAM_SEED_MANIFEST_PREFIX = "manifest/part-";
export const STEAM_SEED_MANIFEST_SUFFIX = ".txt";
export const STEAM_SEED_BATCHES_PREFIX = "batches/";

export const STEAM_REVIEWS_STATE_KEY = "reviews_state.json";
export const STEAM_REVIEWS_BATCHES_PREFIX = "reviews/batches/";

/** Alineado con filtros "full" del desktop (`steam/appdetails.rs`). */
export const DEFAULT_STEAM_FILTERS = "basic,developers,publishers,genres,categories,release_date,screenshots,movies";

export function manifestPartKey(partIndex: number): string {
  const n = String(partIndex).padStart(5, "0");
  return `${STEAM_SEED_MANIFEST_PREFIX}${n}${STEAM_SEED_MANIFEST_SUFFIX}`;
}

export function batchKey(batchSeq: number): string {
  return `${STEAM_SEED_BATCHES_PREFIX}${String(batchSeq).padStart(8, "0")}.jsonl`;
}

export function reviewsBatchKey(batchSeq: number): string {
  return `${STEAM_REVIEWS_BATCHES_PREFIX}${String(batchSeq).padStart(8, "0")}.jsonl`;
}
