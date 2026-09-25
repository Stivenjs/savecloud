/**
 * Resuelve AppIDs numéricos de Steam a nombres legibles.
 * Usa la API pública de Steam Store (no requiere API key).
 * Cachea resultados en memoria para no repetir peticiones.
 */

const cache = new Map<string, string>();

async function fetchAppName(appId: string): Promise<string | null> {
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const data = (await res.json()) as Record<string, { success: boolean; data?: { name: string } }>;
    const entry = data[appId];
    if (entry?.success && entry.data?.name) {
      return entry.data.name;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Dado un array de AppIDs, resuelve todos en paralelo y devuelve un mapa id → nombre.
 * Los IDs que no se puedan resolver se omiten del resultado.
 */
export async function resolveAppNames(appIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const toFetch: string[] = [];

  for (const id of appIds) {
    const cached = cache.get(id);
    if (cached) {
      result.set(id, cached);
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length === 0) return result;

  const settled = await Promise.allSettled(
    toFetch.map(async (id) => {
      const name = await fetchAppName(id);
      return { id, name };
    })
  );

  for (const entry of settled) {
    if (entry.status === "fulfilled" && entry.value.name) {
      cache.set(entry.value.id, entry.value.name);
      result.set(entry.value.id, entry.value.name);
    }
  }

  return result;
}

/**
 * Extrae el AppID numérico de un folderName como "Steam App 2551020" o "EMPRESS — 2050650".
 */
export function extractAppId(folderName: string): string | null {
  const match = folderName.match(/\b(\d{4,})\b/);
  return match ? match[1] : null;
}
