const VERBS =
  /^(abre?|abrir?|habre?|ejecuta(?:r)?|lanza(?:r)?|inicia(?:r)?|juega|jugar|corre(?:r)?|pon(?:er)?|carga(?:r)?|open|launch|start|run|play)\s+/i;

const FILLER_WORDS = /\b(eh+|ah+|um+|uh+|m+h*|pues|o\s+sea|este|bueno|okay|ok|ya|a\s+ver|mhm+|hmm+)\b/gi;

const PHONETIC_SUBSTITUTIONS: Array<[RegExp, string]> = [
  [/\bv/gi, "b"],
  [/\bb/gi, "v"],

  [/^h/i, ""],
  [/\sh(\w)/gi, " $1"],

  [/g([ei])/gi, "j$1"],
  [/j([ei])/gi, "g$1"],

  [/\bll/gi, "y"],
  [/\by/gi, "ll"],

  [/qu([ei])/gi, "k$1"],
  [/k([ei])/gi, "qu$1"],
  [/c([aou])/gi, "k$1"],

  [/z/gi, "s"],
  [/\bs([ei])/gi, "z$1"],

  [/\b1\b/g, "one"],
  [/\b2\b/g, "two"],
  [/\b3\b/g, "three"],
  [/\b4\b/g, "four"],
  [/\b5\b/g, "five"],
  [/\bone\b/gi, "1"],
  [/\btwo\b/gi, "2"],
  [/\bthree\b/gi, "3"],
  [/\bfour\b/gi, "4"],
  [/\bfive\b/gi, "5"],

  [/\bthe\b/gi, "el"],
  [/\bel\b/gi, "the"],
  [/\bof\b/gi, "de"],
  [/\bde\b/gi, "of"],

  [/(\w+)t\b/gi, "$1d"],
  [/(\w+)d\b/gi, "$1t"],
  [/(\w+)s\b/gi, "$1z"],
];

export interface ParsedCommand {
  verb: "open";
  target: string;
  /** Puntuación heurística 0–1 basada en limpieza estructural del texto */
  confidence: number;
}

function cleanTranscript(text: string): string {
  return text.replace(FILLER_WORDS, " ").replace(/\s+/g, " ").trim();
}

/**
 * Confianza heurística basada en características estructurales del texto.
 * No necesita conocer los juegos del usuario.
 */
function computeConfidence(raw: string, cleaned: string): number {
  if (!cleaned) return 0;

  const words = cleaned.split(/\s+/);

  const shortWordRatio = words.filter((w) => w.length <= 2).length / Math.max(words.length, 1);

  const wordScore = words.length >= 1 && words.length <= 6 ? 1 : Math.max(0, 1 - (words.length - 6) * 0.15);

  const retentionRatio = cleaned.length / Math.max(raw.length, 1);

  return Math.min(1, Math.max(0, wordScore * (1 - shortWordRatio * 0.5) * Math.min(1, retentionRatio + 0.3)));
}

/**
 * Parsea un transcript de voz en un comando estructurado.
 * No asume nada sobre qué juegos existen en la librería del usuario.
 */
export function parseVoiceCommand(text: string): ParsedCommand {
  const raw = text.trim();
  const denoised = cleanTranscript(raw);
  const withoutVerb = denoised.replace(VERBS, "").trim();
  const target = withoutVerb.replace(/\s+/g, " ").trim();
  const confidence = computeConfidence(raw, target);

  return { verb: "open", target, confidence };
}

/**
 * Dado un target ya extraído, genera variantes fonéticas alternativas
 * aplicando cada substitución de forma aislada.
 *
 * Por ejemplo, si el STT escuchó "baloran" (con ruido, b/v confundida),
 * una de las variantes intercambiará b↔v y producirá "valoran", que el
 * fuzzy matcher del backend podrá asociar con "Valorant".
 *
 * maxVariants controla cuántas variantes se generan como máximo para
 * no saturar al backend con demasiados candidatos.
 */
export function generatePhoneticVariants(target: string, maxVariants = 6): string[] {
  const variants = new Set<string>();
  variants.add(target);

  for (const [pattern, replacement] of PHONETIC_SUBSTITUTIONS) {
    if (variants.size >= maxVariants) break;

    const re = new RegExp(pattern.source, pattern.flags);
    const variant = target.replace(re, replacement).replace(/\s+/g, " ").trim();

    if (variant && variant !== target && variant.length >= 2) {
      variants.add(variant);
    }
  }

  return Array.from(variants);
}

/**
 * Rankea una lista de alternativas STT por confianza heurística descendente.
 * Prioriza los candidatos más "limpios" para pasarlos primero al backend.
 */
export function rankAlternativesByConfidence(alternatives: string[]): string[] {
  return alternatives
    .map((text) => ({ text, parsed: parseVoiceCommand(text) }))
    .filter(({ parsed }) => parsed.target.length >= 2)
    .sort((a, b) => b.parsed.confidence - a.parsed.confidence)
    .map(({ text }) => text);
}
