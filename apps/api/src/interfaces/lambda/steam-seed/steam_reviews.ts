import type { SteamReviewSummary } from "@interfaces/lambda/steam-seed/types";

export type FetchSteamReviewsResult = {
  httpStatus: number;
  /** Verdadero cuando la API devolvió success:1 con un query_summary válido. */
  reviewsSuccess: boolean | null;
  summary?: SteamReviewSummary;
  error?: string;
  contentType?: string;
  bodyPreview?: string;
};

/**
 * Llama al endpoint oficial GetAppReviews y conserva solo el resumen agregado.
 * `num_per_page=1` limita la descarga al mínimo permitido mientras la API devuelve
 * los totales completos en `query_summary`.
 *
 * El manejo de rate-limit (HTTP 429) replica el de fetchSteamAppDetails: el
 * caller es responsable del backoff — esta función solo expone el status.
 *
 * @param appId  ID numérico de la aplicación en Steam.
 * @param lang   Etiqueta de idioma enviada a la API (p.ej. "english").
 * @returns      Resultado estructurado con el resumen agregado de reseñas o un error.
 */
export async function fetchSteamReviews(appId: number, lang: string): Promise<FetchSteamReviewsResult> {
  const url = new URL("https://api.steampowered.com/IUserReviewsService/GetAppReviews/v1/");
  url.searchParams.set(
    "input_json",
    JSON.stringify({
      appid: appId,
      filter: 0,
      languages: [lang],
      purchase_type: 1,
      num_per_page: 1,
      cursor: "*",
    })
  );

  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  } catch (networkErr) {
    return {
      httpStatus: 0,
      reviewsSuccess: null,
      error: networkErr instanceof Error ? networkErr.message.slice(0, 300) : "network_error",
    };
  }

  const status = res.status;

  if (status === 429) {
    return { httpStatus: status, reviewsSuccess: null, error: "rate_limited" };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      httpStatus: status,
      reviewsSuccess: null,
      error: body.slice(0, 500) || `http_${status}`,
    };
  }

  const bodyText = await res.text().catch(() => "");
  if (!bodyText.trim() || bodyText === "null") {
    return { httpStatus: status, reviewsSuccess: null, error: "empty_body" };
  }

  let root: Record<string, unknown>;
  try {
    root = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return {
      httpStatus: status,
      reviewsSuccess: null,
      error: "json_parse",
      contentType: res.headers.get("content-type")?.slice(0, 120) || undefined,
      bodyPreview: bodyText
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200),
    };
  }

  // IUserReviewsService envuelve los datos en { response: { query_summary, ... } }.
  const response = root.response as Record<string, unknown> | undefined;
  if (!response || typeof response !== "object") {
    return { httpStatus: status, reviewsSuccess: null, error: "missing_response" };
  }

  const raw = response.query_summary as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") {
    return {
      httpStatus: status,
      reviewsSuccess: true,
      summary: {
        num_reviews: 0,
        review_score: 0,
        review_score_desc: "",
        total_positive: 0,
        total_negative: 0,
        total_reviews: 0,
      },
    };
  }

  const summary: SteamReviewSummary = {
    num_reviews: toInt(raw.num_reviews),
    review_score: toInt(raw.review_score),
    review_score_desc: typeof raw.review_score_desc === "string" ? raw.review_score_desc : "",
    total_positive: toInt(raw.total_positive),
    total_negative: toInt(raw.total_negative),
    total_reviews: toInt(raw.total_reviews),
  };

  return { httpStatus: status, reviewsSuccess: true, summary };
}

function toInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}
