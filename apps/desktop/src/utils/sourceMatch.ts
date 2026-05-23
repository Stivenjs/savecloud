import type { DownloadProtocol, SourceBestMatch } from "@services/tauri";

/** Separador improbable; válido en atributos `id` de HeroUI ListBox. */
const SEP = "|||";

/** Método de descarga que usará `start_source_download` sin `preferredProtocol`. */
export type EffectiveDownloadKind = "http" | "torrent" | "unknown";

/** Replica la prioridad de `start_source_download` en Rust: torrent antes que HTTP. */
export function resolveDefaultDownloadKind(
  protocols: readonly (DownloadProtocol | string)[] | undefined
): EffectiveDownloadKind {
  if (!protocols?.length) return "unknown";
  if (protocols.some((p) => p === "torrentMagnet" || p === "torrentFile")) {
    return "torrent";
  }
  if (protocols.includes("http")) return "http";
  return "unknown";
}

export function downloadKindLabel(kind: EffectiveDownloadKind): string {
  switch (kind) {
    case "torrent":
      return "BitTorrent";
    case "http":
      return "HTTP";
    default:
      return "Desconocido";
  }
}

export function downloadKindDescription(kind: EffectiveDownloadKind): string {
  switch (kind) {
    case "torrent":
      return "Descarga P2P con el motor integrado (magnet o .torrent).";
    case "http":
      return "Descarga directa desde el hoster del enlace.";
    default:
      return "No se pudo determinar el método de descarga.";
  }
}

/** Clave estable para identificar un candidato en selects y estado local. */
export function sourceCandidateKey(c: SourceBestMatch): string {
  return `${c.source_id}${SEP}${c.item_id}`;
}

/** Obtiene el candidato seleccionado o el mejor por defecto. */
export function pickCandidate(
  candidates: SourceBestMatch[] | undefined,
  key: string | null | undefined
): SourceBestMatch | undefined {
  if (!candidates?.length) {
    return undefined;
  }
  if (!key) {
    return candidates[0]; // El primero siempre es el "best" gracias al sort de Rust
  }
  return candidates.find((c) => sourceCandidateKey(c) === key) ?? candidates[0];
}

/** * Mapper limpio: Convierte el arreglo de tuplas de Rust
 * en un diccionario fácil de consumir por React.
 */
export function mapBatchMatchesToRecord(rawMatches: any): Record<string, SourceBestMatch[]> {
  const map: Record<string, SourceBestMatch[]> = {};

  if (!rawMatches || !Array.isArray(rawMatches)) {
    return map;
  }

  for (const tuple of rawMatches) {
    // Verificamos que sea una tupla válida de 2 posiciones [nombreDelJuego, arregloDeMatches]
    if (Array.isArray(tuple) && tuple.length === 2) {
      const [gameName, matches] = tuple;
      map[gameName] = matches;
    }
  }

  return map;
}
