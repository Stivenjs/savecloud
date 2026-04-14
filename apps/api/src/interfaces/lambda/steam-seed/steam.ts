export type FetchSteamResult = {
  httpStatus: number;
  steamSuccess: boolean | null;
  data?: unknown;
  error?: string;
};

/**
 * Llama a `store.steampowered.com/api/appdetails` y devuelve `data` (o not-found).
 * Mantiene lógica conservadora ante 429 para que el caller haga backoff.
 */
export async function fetchSteamAppDetails(appId: number, lang: string, filters: string): Promise<FetchSteamResult> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=${encodeURIComponent(lang)}&filters=${encodeURIComponent(filters)}`;
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  const status = res.status;

  if (status === 429) return { httpStatus: status, steamSuccess: null, error: "rate_limited" };

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { httpStatus: status, steamSuccess: null, error: t.slice(0, 500) || `http_${status}` };
  }

  const bodyText = await res.text();
  if (!bodyText.trim() || bodyText === "null") {
    return { httpStatus: status, steamSuccess: null, error: "empty_body" };
  }

  let root: Record<string, unknown>;
  try {
    root = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return { httpStatus: status, steamSuccess: null, error: "json_parse" };
  }

  const sid = String(appId);
  const entry = root[sid] as Record<string, unknown> | undefined;
  const success = Boolean(entry?.success);
  if (!success) return { httpStatus: status, steamSuccess: false };

  return { httpStatus: status, steamSuccess: true, data: entry?.data };
}
