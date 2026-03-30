export type TtlCacheOptions = {
  /** TTL en milisegundos. */
  ttlMs: number;
  /** Máximo de entradas (best-effort). */
  maxEntries?: number;
};

type Entry<V> = { value: V; expiresAt: number };

/**
 * Caché TTL in-memory (por instancia).
 *
 * Ideal para Lambdas “warm”: evita repetir listados de S3 dentro de una misma instancia.
 * No es un caché distribuido ni persistente.
 */
export class TtlCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: TtlCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries ?? 500;
  }

  get(key: K, now: number = Date.now()): V | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: K, value: V, now: number = Date.now()): void {
    // best-effort: evita crecimiento infinito si se usa con claves variables
    if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value as K | undefined;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
    this.map.set(key, { value, expiresAt: now + this.ttlMs });
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  keys(): K[] {
    return Array.from(this.map.keys());
  }
}
