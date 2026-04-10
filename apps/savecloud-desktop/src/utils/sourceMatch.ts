import type { SourceBestMatch } from "@services/tauri";

/** Separador improbable; válido en atributos `id` de HeroUI ListBox. */
const SEP = "|||";

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
