import type { SteamAppDetailsResult } from "@services/tauri";

/** Por debajo de esto, la API suele devolver una línea vacía o marketing mínimo: usamos extracto del HTML. */
const SHORT_DESC_MIN_CHARS = 80;
const EXCERPT_MAX_CHARS = 520;

function steamPlainTextFromHtml(html: string): string {
  if (!html?.trim()) return "";
  try {
    const el = document.createElement("div");
    el.innerHTML = html;
    return (el.textContent ?? "").replace(/\s+/g, " ").trim();
  } catch {
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
}

function steamExcerptFromDetailed(html: string, maxLen = EXCERPT_MAX_CHARS): string {
  const t = steamPlainTextFromHtml(html);
  if (!t) return "";
  if (t.length <= maxLen) return t;
  const slice = t.slice(0, maxLen);
  const last = slice.lastIndexOf(" ");
  return (last > 120 ? slice.slice(0, last) : slice) + "…";
}

export interface SteamSummaryBlurb {
  text: string;
  subtitle: string;
}

/**
 * Texto para la pestaña Resumen: prioriza la descripción corta si es sustancial;
 * si no, combina o sustituye por un extracto legible de la descripción HTML.
 */
export function resolveSteamSummaryBlurb(details: SteamAppDetailsResult): SteamSummaryBlurb | null {
  const short = details.shortDescription?.trim() ?? "";
  const longHtml = details.detailedDescription?.trim() ?? "";

  if (short.length >= SHORT_DESC_MIN_CHARS) {
    return { text: short, subtitle: "Texto de la ficha en Steam" };
  }

  const excerpt = longHtml ? steamExcerptFromDetailed(longHtml) : "";

  if (short.length > 0 && excerpt) {
    const s = short.toLowerCase();
    const excerptLower = excerpt.toLowerCase();
    if (excerptLower.startsWith(s) || excerptLower.includes(s.slice(0, Math.min(24, s.length)))) {
      return {
        text: excerpt,
        subtitle: "Extracto de la descripción completa (la sinopsis corta es muy breve)",
      };
    }
    return {
      text: `${short}\n\n${excerpt}`,
      subtitle: "Sinopsis corta y extracto de la descripción completa",
    };
  }

  if (excerpt) {
    return {
      text: excerpt,
      subtitle: "Fragmento de la descripción completa (sin sinopsis corta en la tienda)",
    };
  }

  if (short.length > 0) {
    return { text: short, subtitle: "Texto de la ficha en Steam" };
  }

  return null;
}
