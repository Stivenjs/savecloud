export type SteamSeedStateV1 = {
  version: 1;
  priorityLine: number;
  priorityDone: boolean;
  /** Firma del contenido de priority_appids.jsonl para detectar cambios. */
  prioritySignature: string | null;
  /** Firma combinada de los ETags de los manifiestos en S3 para detectar actualizaciones de catálogo. */
  manifestSignature?: string | null;
  manifestPart: number;
  manifestLine: number;
  batchSeq: number;
  backoffUntil: string | null;
  catalogComplete: boolean;
  totals: {
    processed: number;
    steamOk: number;
    steamNotFound: number;
    httpErrors: number;
  };
};

export type BatchLineV1 = {
  appId: number;
  fetchedAt: string;
  httpStatus: number;
  steamSuccess: boolean | null;
  data?: unknown;
  error?: string;
};

/**
 * Estado del cursor para el pase de reseñas.
 *
 * Itera directamente sobre `processed_appids.json` — la lista de IDs que
 * el tick de detalles ya confirmó como válidos en Steam. Esto evita pedir
 * reseñas de juegos inexistentes y simplifica el cursor a un único `offset`.
 *
 * Cuando `offset` alcanza el total de IDs procesados se reinicia a 0 para
 * mantener los conteos de reseñas actualizados en futuras pasadas del catálogo.
 */
export type SteamReviewsStateV1 = {
  version: 1;
  /** Posición actual en el array ordenado de processed_appids.json. */
  offset: number;
  /** Contador secuencial para los archivos de batch (reviews/batches/00000001.jsonl). */
  batchSeq: number;
  backoffUntil: string | null;
  totals: {
    processed: number;
    ok: number;
    notFound: number;
    httpErrors: number;
  };
};

/**
 * Resumen agregado de reseñas devuelto por el endpoint de Steam.
 * Se solicita con num_per_page=0 para no almacenar texto de reseñas individuales.
 */
export type SteamReviewSummary = {
  /** Total de reseñas (positivas + negativas). */
  num_reviews: number;
  /** Índice del descriptor de puntuación de Steam (0-9). */
  review_score: number;
  /** Etiqueta legible, por ejemplo "Very Positive". */
  review_score_desc: string;
  total_positive: number;
  total_negative: number;
  total_reviews: number;
};

export type ReviewsBatchLineV1 = {
  appId: number;
  fetchedAt: string;
  httpStatus: number;
  /** Verdadero cuando la API respondió con success:1 y un resumen válido. */
  reviewsSuccess: boolean | null;
  summary?: SteamReviewSummary;
  error?: string;
};
