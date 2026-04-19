import { genConfig } from "react-nice-avatar";

export type NiceAvatarConfig = ReturnType<typeof genConfig>;
const NICE_AVATAR_PREFIX = "nice-avatar://";

export function generateNiceAvatarSeed(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function buildNiceAvatarConfig(seed: string): NiceAvatarConfig {
  return genConfig(seed.trim());
}

export function serializeNiceAvatarConfig(config: NiceAvatarConfig): string {
  return `${NICE_AVATAR_PREFIX}${encodeURIComponent(JSON.stringify(config))}`;
}

export function parseNiceAvatarConfig(raw: string | null | undefined): NiceAvatarConfig | null {
  if (!raw?.startsWith(NICE_AVATAR_PREFIX)) return null;
  const encoded = raw.slice(NICE_AVATAR_PREFIX.length);
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded)) as NiceAvatarConfig;
    return parsed;
  } catch {
    return null;
  }
}

function decodeDataPayload(raw: string): string | null {
  const commaIndex = raw.indexOf(",");
  if (commaIndex <= 0) return null;
  const prefix = raw.slice(0, commaIndex).toLowerCase();
  const payload = raw.slice(commaIndex + 1);

  try {
    if (prefix.includes(";base64")) {
      if (typeof atob !== "function") return null;
      return atob(payload);
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

export function parseLegacyNiceAvatarHtml(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("data:image/svg+xml")) return null;
  const decoded = decodeDataPayload(raw)?.trim();
  if (!decoded?.startsWith("<div")) return null;

  // La primera integración guardó HTML en una data URL de SVG. Esta normalización
  // permite renderizarlo dentro de un contenedor responsivo.
  return decoded.replace(/width:\s*112px/gi, "width:100%").replace(/height:\s*112px/gi, "height:100%");
}
