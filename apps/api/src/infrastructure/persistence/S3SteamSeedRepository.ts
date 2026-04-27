import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { batchKey } from "@interfaces/lambda/steam-seed/layout";
import { PRESIGN_EXPIRES_IN_SECONDS } from "@infrastructure/persistence/S3SaveRepository";

function isNoSuchKey(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: string }).name === "NoSuchKey";
}

/**
 * Divide el array en lotes del tamaño indicado.
 *
 * @param arr   - Array a dividir.
 * @param size  - Tamaño máximo de cada lote.
 * @returns Array de lotes.
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

type SeedState = {
  version: 1;
  priorityLine: number;
  priorityDone: boolean;
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

/** Resultado de la resolución de una URL de batch. */
export type BatchDownloadResult = {
  /** Clave S3 para este batch. */
  key: string;
  /** URL de descarga pre-firmada, o `null` si la generación falla. */
  url: string | null;
  /** Mensaje de error cuando `url` es `null`. */
  error?: string;
};

function defaultState(): SeedState {
  return {
    version: 1,
    priorityLine: 0,
    priorityDone: false,
    manifestPart: 0,
    manifestLine: 0,
    batchSeq: 0,
    backoffUntil: null,
    catalogComplete: false,
    totals: {
      processed: 0,
      steamOk: 0,
      steamNotFound: 0,
      httpErrors: 0,
    },
  };
}

/**
 * Número máximo de llamadas a `getSignedUrl` emitidas en paralelo dentro de
 * {@link S3SteamSeedRepository.getBatchDownloadUrl} cuando se pasan múltiples claves.
 * Las conexiones AWS SDK se agrupan por cliente, por lo que mantén este número razonable para
 * evitar agotar el pool de sockets del agente HTTP.
 */
const PRESIGN_CONCURRENCY = 250;

export class S3SteamSeedRepository {
  constructor(
    private readonly s3: S3Client,
    private readonly bucketName: string
  ) {}

  /**
   * Devuelve el prefijo de clave S3 que posee todos los objetos para `ownerId`.
   *
   * @param ownerId - Identificador del propietario proporcionado por el caller (llamador); debe ser no vacío.
   * @throws {Error} Cuando `ownerId` es vacío.
   */
  private basePrefix(ownerId: string): string {
    const clean = ownerId.trim();
    if (!clean) throw new Error("ownerId is required");
    return `steam-seed/${clean}/`;
  }

  /**
   * Protege contra ataques de path-traversal asegurando que `key` esté estrictamente
   * dentro del prefijo del propietario.
   *
   * @param ownerId - Propietario cuyo prefijo se utiliza como límite.
   * @param key     - Clave S3 a validar.
   * @throws {Error} Cuando la clave escapa del prefijo del propietario.
   */
  private assertOwnedKey(ownerId: string, key: string): void {
    const prefix = this.basePrefix(ownerId);
    if (!key.startsWith(prefix) || key.includes("..")) {
      throw new Error("Invalid key: must belong to owner seed prefix");
    }
  }

  /**
   * Lista claves bajo un prefijo de steam-seed con paginación opcional.
   */
  private async listSeedKeysByPrefix(
    ownerId: string,
    suffixPrefix: string,
    maxKeys: number = 200,
    continuationToken?: string
  ): Promise<{ keys: string[]; nextCursor?: string }> {
    const prefix = `${this.basePrefix(ownerId)}${suffixPrefix}`;
    const out = await this.s3.send(
      new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        MaxKeys: Math.max(1, Math.min(1000, maxKeys)),
        ContinuationToken: continuationToken,
      })
    );
    const keys = (out.Contents ?? [])
      .map((x) => x.Key)
      .filter((k): k is string => !!k)
      .sort();
    return {
      keys,
      nextCursor: out.IsTruncated ? out.NextContinuationToken : undefined,
    };
  }

  /**
   * Genera una URL de subida pre-firmada para un parte del manifiesto.
   *
   * @param ownerId   - Identificador del propietario.
   * @param partIndex - Índice de parte basado en cero (debe ser un número finito no negativo).
   * @returns Objeto que contiene la `uploadUrl` y la clave S3 objetivo.
   * @throws {Error} Cuando `partIndex` es inválido.
   */
  async getManifestUploadUrl(ownerId: string, partIndex: number): Promise<{ uploadUrl: string; key: string }> {
    if (!Number.isFinite(partIndex) || partIndex < 0) {
      throw new Error("partIndex must be >= 0");
    }
    const key = `${this.basePrefix(ownerId)}manifest/part-${String(partIndex).padStart(5, "0")}.txt`;
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: "text/plain; charset=utf-8",
    });
    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: PRESIGN_EXPIRES_IN_SECONDS,
    });
    return { uploadUrl, key };
  }

  /**
   * Genera una URL de subida pre-firmada para subir el archivo de app-ids de prioridad.
   *
   * @param ownerId - Identificador del propietario.
   * @returns Objeto que contiene la `uploadUrl` y la clave S3 objetivo.
   */
  async getPriorityUploadUrl(ownerId: string): Promise<{ uploadUrl: string; key: string }> {
    const key = `${this.basePrefix(ownerId)}priority_appids.jsonl`;
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: "text/plain; charset=utf-8",
    });
    const uploadUrl = await getSignedUrl(this.s3, command, {
      expiresIn: PRESIGN_EXPIRES_IN_SECONDS,
    });
    return { uploadUrl, key };
  }

  /**
   * Genera una URL de descarga pre-firmada para descargar el archivo de app-ids de prioridad.
   *
   * @param ownerId - Identificador del propietario.
   * @returns URL de descarga pre-firmada.
   */
  async getPriorityDownloadUrl(ownerId: string): Promise<string> {
    const key = `${this.basePrefix(ownerId)}priority_appids.jsonl`;
    const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key });
    return getSignedUrl(this.s3, command, {
      expiresIn: PRESIGN_EXPIRES_IN_SECONDS,
    });
  }

  /**
   * Genera una URL de descarga pre-firmada para una **única** clave de batch.
   *
   * @param ownerId - Identificador del propietario.
   * @param key     - Clave S3 completa para el objeto de batch.
   * @returns URL de descarga pre-firmada como `string`.
   * @throws {Error} Cuando la clave no pertenece al prefijo del propietario.
   */
  async getBatchDownloadUrl(ownerId: string, key: string): Promise<string>;

  /**
   * Genera URLs de descarga pre-firmada para **múltiples** claves de batch en paralelo.
   *
   * Las llamadas se emiten en lotes concurrentes (hasta {@link PRESIGN_CONCURRENCY}
   * a la vez) para maximizar el rendimiento sin sobrecargar el agente HTTP.
   * Los fallos individuales se capturan por clave para que una mala clave nunca bloquee
   * el resto — comprueba `result.error` para detectar fallos parciales.
   *
   * @example
   * ```ts
   * const { keys } = await repo.listBatchKeys(ownerId);
   * const results  = await repo.getBatchDownloadUrl(ownerId, keys);
   * const urls     = results.filter(r => r.url !== null).map(r => r.url!);
   * ```
   *
   * @param ownerId - Identificador del propietario utilizado para la validación de path-traversal.
   * @param keys    - Array de claves S3 completas para pre-firmar.
   * @returns Array de {@link BatchDownloadResult}, uno por clave de entrada,
   *          preservando el orden original.
   */
  async getBatchDownloadUrl(ownerId: string, keys: string[]): Promise<BatchDownloadResult[]>;

  /**
   * Implementación unificada de los overloads anteriores.
   * - `key: string`    → devuelve `Promise<string>` (backward-compat).
   * - `keys: string[]` → devuelve `Promise<BatchDownloadResult[]>` (bulk, paralelo).
   */
  async getBatchDownloadUrl(ownerId: string, keyOrKeys: string | string[]): Promise<string | BatchDownloadResult[]> {
    if (Array.isArray(keyOrKeys)) {
      if (keyOrKeys.length === 0) return [];

      // Validar todas las claves de antemano — guardia O(n) rápida antes de cualquier trabajo asíncrono.
      for (const key of keyOrKeys) {
        this.assertOwnedKey(ownerId, key);
      }

      const results: BatchDownloadResult[] = new Array(keyOrKeys.length);
      const chunks = chunkArray(
        keyOrKeys.map((key, idx) => ({ key, idx })),
        PRESIGN_CONCURRENCY
      );

      for (const chunk of chunks) {
        // Todos los elementos en un lote se emiten simultáneamente.
        await Promise.all(
          chunk.map(async ({ key, idx }) => {
            try {
              const command = new GetObjectCommand({ Bucket: this.bucketName, Key: key });
              const url = await getSignedUrl(this.s3, command, { expiresIn: PRESIGN_EXPIRES_IN_SECONDS });
              results[idx] = { key, url };
            } catch (err) {
              results[idx] = {
                key,
                url: null,
                error: err instanceof Error ? err.message : String(err),
              };
            }
          })
        );
      }

      return results;
    }

    this.assertOwnedKey(ownerId, keyOrKeys);
    const command = new GetObjectCommand({ Bucket: this.bucketName, Key: keyOrKeys });
    return getSignedUrl(this.s3, command, { expiresIn: PRESIGN_EXPIRES_IN_SECONDS });
  }

  /**
   * Sobrescribe `state.json` con el estado de semilla por defecto, efectivamente
   * restarting a seeding job from the beginning.
   *
   * @param ownerId - Identificador del propietario.
   */
  async resetState(ownerId: string): Promise<void> {
    const key = `${this.basePrefix(ownerId)}state.json`;
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(defaultState()),
        ContentType: "application/json",
      })
    );
  }

  /**
   * Lee `state.json` para el propietario dado y devuelve un resumen del
   * progreso actual de la semilla.
   *
   * `batchSeq` en el estado persistente es el **siguiente** índice a escribir,
   * por lo que el último archivo escrito corresponde a `batchSeq - 1`.
   *
   * Devuelve valores ceroados (no es un error) cuando el archivo de estado no existe todavía — es decir, el trabajo nunca ha sido iniciado.
   *
   * @param ownerId - Identificador del propietario.
   * @returns Objeto que contiene:
   *   - `lastBatchKey`    — Clave S3 completa del último batch escrito,
   *                         o `null` cuando no se ha escrito ningún batch.
   *   - `batchSeq`        — Número de batches escritos hasta ahora.
   *   - `catalogComplete` — Si el catálogo completo de Steam ha sido procesado.
   * @throws Vuelve a lanzar cualquier error S3 que no sea un `NoSuchKey`.
   */
  async getSteamSeedStatus(ownerId: string): Promise<{
    lastBatchKey: string | null;
    batchSeq: number;
    catalogComplete: boolean;
  }> {
    const stateKey = `${this.basePrefix(ownerId)}state.json`;
    try {
      const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucketName, Key: stateKey }));
      const raw = await out.Body?.transformToString();
      if (!raw) {
        return { lastBatchKey: null, batchSeq: 0, catalogComplete: false };
      }
      const parsed = JSON.parse(raw) as {
        batchSeq?: unknown;
        catalogComplete?: unknown;
      };
      const batchSeqRaw = parsed.batchSeq;
      const batchSeq =
        typeof batchSeqRaw === "number" && Number.isFinite(batchSeqRaw) ? Math.max(0, Math.floor(batchSeqRaw)) : 0;
      const catalogComplete = Boolean(parsed.catalogComplete);
      const prefix = this.basePrefix(ownerId);
      const lastBatchKey = batchSeq > 0 ? `${prefix}${batchKey(batchSeq - 1)}` : null;
      return { lastBatchKey, batchSeq, catalogComplete };
    } catch (e) {
      if (isNoSuchKey(e)) {
        return { lastBatchKey: null, batchSeq: 0, catalogComplete: false };
      }
      throw e;
    }
  }

  /**
   * Lista las claves S3 bajo el prefijo `batches/` para el propietario dado, con
   * paginación opcional basada en cursor.
   *
   * Las claves se devuelven **ordenadas lexicográficamente**, lo que preserva el orden natural cuando las claves están rellenadas con ceros (como produce `batchKey()`).
   *
   * @param ownerId           - Identificador del propietario.
   * @param maxKeys           - Número máximo de claves a devolver por página
   *                            (acotado a [1, 1000]; por defecto: 200).
   * @param continuationToken - Cursor de paginación opaco devuelto por una llamada anterior como `nextCursor`.
   * @returns Objeto que contiene:
   *   - `keys`       — Array de claves S3 ordenadas.
   *   - `nextCursor` — Cursor para pasar en la siguiente llamada, o `undefined` cuando todos los resultados han sido devueltos.
   */
  async listBatchKeys(
    ownerId: string,
    maxKeys: number = 200,
    continuationToken?: string
  ): Promise<{ keys: string[]; nextCursor?: string }> {
    return this.listSeedKeysByPrefix(ownerId, "batches/", maxKeys, continuationToken);
  }

  /**
   * Lista claves S3 bajo el prefijo `reviews/batches/`.
   */
  async listReviewBatchKeys(
    ownerId: string,
    maxKeys: number = 200,
    continuationToken?: string
  ): Promise<{ keys: string[]; nextCursor?: string }> {
    return this.listSeedKeysByPrefix(ownerId, "reviews/batches/", maxKeys, continuationToken);
  }

  /**
   * Lista **todas** las claves de batch para un propietario (paginación automática) y genera inmediatamente URLs de descarga pre-firmadas para cada clave — todas en paralelo.
   *
   * Este es el método recomendado cuando necesitas exponer el conjunto completo de batches a un cliente en una sola llamada.
   *
   * @example
   * ```ts
   * const results = await repo.listAndPresignAllBatches(ownerId);
   * const urls    = results.filter(r => r.url).map(r => r.url!);
   * ```
   *
   * @param ownerId - Identificador del propietario.
   * @returns Array de {@link BatchDownloadResult} para cada clave de batch encontrada.
   */
  async listAndPresignAllBatches(ownerId: string): Promise<BatchDownloadResult[]> {
    const allKeys: string[] = [];
    let cursor: string | undefined;

    // Paginar a través de todas las claves (cada página es una sola llamada a la API de S3).
    do {
      const page = await this.listBatchKeys(ownerId, 1000, cursor);
      allKeys.push(...page.keys);
      cursor = page.nextCursor;
    } while (cursor);

    return this.getBatchDownloadUrl(ownerId, allKeys);
  }
}
