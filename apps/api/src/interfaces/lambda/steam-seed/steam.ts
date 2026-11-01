import { retryAfterMs, waitForRequestSlot } from "@interfaces/lambda/steam-seed/request_gate";

export type FetchSteamResult = {
  httpStatus: number;
  steamSuccess: boolean | null;
  retryAfterMs?: number | null;
  data?: unknown;
  error?: string;
};

/**
 * Llama a `store.steampowered.com/api/appdetails` y devuelve `data` (o not-found).
 * Mantiene lógica conservadora ante 429 para que el caller haga backoff.
 */
export async function fetchSteamAppDetails(appId: number, lang: string, filters: string): Promise<FetchSteamResult> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=${encodeURIComponent(lang)}&filters=${encodeURIComponent(filters)}`;
  const minimumIntervalMs = envInt("STEAM_MIN_REQUEST_INTERVAL_MS", 4_000);
  await waitForRequestSlot("store.steampowered.com", minimumIntervalMs);
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  } catch (error) {
    return {
      httpStatus: 0,
      steamSuccess: null,
      error: error instanceof Error ? error.message.slice(0, 300) : "network_error",
    };
  }
  const status = res.status;

  if (status === 429) {
    return {
      httpStatus: status,
      steamSuccess: null,
      retryAfterMs: retryAfterMs(res.headers.get("retry-after")),
      error: "rate_limited",
    };
  }

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

function envInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
