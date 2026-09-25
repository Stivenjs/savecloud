/**
 * Procesa elementos con concurrencia limitada, preservando el orden de salida.
 *
 * @example
 * const out = await processWithConcurrencyLimit(items, 4, async (item) => doWork(item));
 */
export async function processWithConcurrencyLimit<T, R>(
  items: readonly T[],
  maxConcurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, Math.floor(maxConcurrency || 1));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runOne(): Promise<void> {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current]!, current);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => runOne());
  await Promise.all(runners);
  return results;
}
