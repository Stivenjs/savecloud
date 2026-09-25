import type { SteamReviewSummary } from "@interfaces/lambda/steam-seed/types";

export type FetchSteamReviewsResult = {
  httpStatus: number;
  /** Verdadero cuando la API devolvió success:1 con un query_summary válido. */
  reviewsSuccess: boolean | null;
  summary?: SteamReviewSummary;
  error?: string;
};

/**
 * Llama al endpoint de reseñas de Steam para un appId con `num_per_page=0`
 * para obtener únicamente el `query_summary` agregado (sin texto de reseñas individuales).
 *
 * El parámetro `cursor=*` es requerido por la API incluso con num_per_page=0;
 * sin él algunos títulos devuelven una respuesta vacía.
 *
 * El manejo de rate-limit (HTTP 429) replica el de fetchSteamAppDetails: el
 * caller es responsable del backoff — esta función solo expone el status.
 *
 * @param appId  ID numérico de la aplicación en Steam.
 * @param lang   Etiqueta de idioma enviada a la API (p.ej. "english").
 * @returns      Resultado estructurado con el resumen agregado de reseñas o un error.
 */
export async function fetchSteamReviews(appId: number, lang: string): Promise<FetchSteamReviewsResult> {
  const url =
    `https://store.steampowered.com/appreviews/${appId}` +
    `?json=1&num_per_page=0&cursor=*&purchase_type=all&language=${encodeURIComponent(lang)}`;

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
    return { httpStatus: status, reviewsSuccess: null, error: "json_parse" };
  }

  // La API envuelve la respuesta en { success: 1, query_summary: {...}, cursor: "..." }
  if (root.success !== 1) {
    return { httpStatus: status, reviewsSuccess: false };
  }

  const raw = root.query_summary as Record<string, unknown> | undefined;
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
