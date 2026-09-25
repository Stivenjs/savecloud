import type { FastifyReply, FastifyRequest } from "fastify";

export interface SummaryEtagItem {
  gameId: string;
  fileCount: number;
  totalSizeBytes: number;
  lastModified: string | null;
}

export interface SaveEtagItem {
  key: string;
  lastModified: Date;
  size?: number;
}

/**
 * Calcula un weak ETag liviano y determinista para una lista de guardados.
 * Complejidad O(N) sin transformaciones de cadenas pesadas ni asignaciones redundantes.
 */
export function computeSavesEtag(saves: readonly SaveEtagItem[]): string {
  if (saves.length === 0) return 'W/"0-0-0"';
  let maxTime = 0;
  let totalSize = 0;
  for (const s of saves) {
    const t = s.lastModified instanceof Date ? s.lastModified.getTime() : new Date(s.lastModified).getTime();
    if (t > maxTime) maxTime = t;
    totalSize += s.size ?? 0;
  }
  return `W/"${saves.length}-${totalSize}-${maxTime}"`;
}

/**
 * Calcula un weak ETag liviano para el resumen consolidado de partidas.
 */
export function computeSummaryEtag(summary: readonly SummaryEtagItem[]): string {
  if (summary.length === 0) return 'W/"0-0-0"';
  let totalFiles = 0;
  let totalBytes = 0;
  let latest = "";
  for (const item of summary) {
    totalFiles += item.fileCount;
    totalBytes += item.totalSizeBytes;
    if (item.lastModified && item.lastModified > latest) {
      latest = item.lastModified;
    }
  }
  return `W/"${summary.length}-${totalFiles}-${totalBytes}-${latest}"`;
}

/**
 * Comprueba las cabeceras de caché condicional If-None-Match.
 * Inyecta las cabeceras ETag y Cache-Control; si no hubo modificaciones,
 * emite una respuesta HTTP 304 Not Modified y retorna `true`.
 */
export function send304IfNotModified(request: FastifyRequest, reply: FastifyReply, etag: string): boolean {
  reply.header("ETag", etag);
  reply.header("Cache-Control", "private, no-cache");

  if (request.headers["if-none-match"] === etag) {
    reply.status(304).send();
    return true;
  }

  return false;
}
