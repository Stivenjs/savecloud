export type SteamSeedStateV1 = {
  version: 1;
  priorityLine: number;
  priorityDone: boolean;
  /** Fingerprint del contenido de `priority_appids.jsonl` para detectar cambios. */
  prioritySignature: string | null;
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
