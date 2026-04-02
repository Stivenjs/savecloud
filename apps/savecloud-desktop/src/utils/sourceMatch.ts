import type { SourceMatchCandidate } from "@services/tauri/sources.service";

/** Separador improbable en `sourceId` / `itemId`; válido en atributos `id` de HeroUI ListBox. */
const SEP = "|||";

/** Clave estable para identificar un candidato en selects y estado local. */
export function sourceCandidateKey(c: SourceMatchCandidate): string {
  return `${c.sourceId}${SEP}${c.itemId}`;
}

export function pickCandidate(
  candidates: SourceMatchCandidate[] | undefined,
  key: string | null | undefined
): SourceMatchCandidate | undefined {
  if (!candidates?.length) {
    return undefined;
  }
  if (!key) {
    return candidates[0];
  }
  return candidates.find((c) => sourceCandidateKey(c) === key) ?? candidates[0];
}
