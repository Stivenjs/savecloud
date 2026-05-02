import type { ConfiguredGame } from "@app-types/config";
import type { PathCandidate } from "@services/tauri";

/** Normalización para deduplicar o comparar rutas en Windows/Linux. */
export function normPathKey(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Deduplica rutas conservando orden y la primera ortografía que apareció. */
export function dedupePreserveGamePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    if (!p.trim()) continue;
    const k = normPathKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p.trim());
  }
  return out;
}

/** Rutas que declara el backend en un candidato del escaneo. */
export function pathsDeclaredOnCandidate(c: PathCandidate): string[] {
  const raw = c.paths?.length ? c.paths : [c.path];
  return dedupePreserveGamePaths(raw);
}

/**
 * Si alguna ruta del candidato coincide con un juego configurado,
 * devuelve todas las rutas locales de ese juego unidas al conjunto del scan.
 * No coincide solo por Steam App ID (varias ediciones pueden compartir id).
 */
export function mergeScanPathsWithConfigured(
  candidate: PathCandidate,
  games: readonly ConfiguredGame[]
): { paths: string[]; mergedFromConfigured: boolean } {
  const fromScan = pathsDeclaredOnCandidate(candidate);
  const scanKeys = new Set(fromScan.map(normPathKey));

  const game = games.find((g) => g.paths.some((gp) => scanKeys.has(normPathKey(gp))));
  if (!game?.paths?.length) return { paths: fromScan, mergedFromConfigured: false };

  const merged = dedupePreserveGamePaths([...fromScan, ...game.paths]);
  const mergedFromConfigured = merged.length > fromScan.length;
  return { paths: merged, mergedFromConfigured };
}
