import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

/** Normaliza ruta Windows para `convertFileSrc` (barra invertida → `/`). */
function normalizeLocalPath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Resuelve URL remota, data URL o ruta local de disco para `<img>` / `<video>`.
 * Las rutas locales requieren Tauri con `assetProtocol` habilitado en `tauri.conf.json`.
 */
export function resolveProfileAsset(src: string | undefined | null): string | null {
  if (!src?.trim()) return null;
  const s = src.trim();
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("data:") || s.startsWith("blob:")) {
    return s;
  }
  if (!isTauri()) {
    return null;
  }
  try {
    return convertFileSrc(normalizeLocalPath(s));
  } catch {
    return null;
  }
}

/** Heurística para usar `<video>` en lugar de `<img>`. */
export function isProfileVideoSource(raw: string | undefined | null): boolean {
  if (!raw?.trim()) return false;
  const s = raw.trim().toLowerCase();
  return /\.(mp4|webm|mov|m4v|ogg)(\?|#|$)/.test(s);
}
