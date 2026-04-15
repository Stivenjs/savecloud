import { invoke } from "@tauri-apps/api/core";

export interface CreateShareResult {
  shareUrl: string;
}

export interface ResolveShareResult {
  userId: string;
  gameId: string;
}

/**
 * Invoca al backend de Rust para crear un link de compartición.
 * Rust se encargará de recuperar la API Key real del Keyring.
 */
export async function createShareLink(gameId: string, expiresInDays?: number): Promise<CreateShareResult> {
  try {
    const shareUrl = await invoke<string>("create_remote_share_link", {
      gameId,
      expiresInDays: expiresInDays ?? 7,
    });

    return { shareUrl };
  } catch (error) {
    console.error("Error en createShareLink:", error);
    throw new Error(typeof error === "string" ? error : "No se pudo crear el link");
  }
}

/**
 * Invoca al backend de Rust para resolver un token.
 * Útil para previsualizar qué juego y qué usuario están detrás de un link.
 */
export async function resolveShareToken(token: string): Promise<ResolveShareResult> {
  try {
    return await invoke<ResolveShareResult>("resolve_remote_share_token", {
      token,
    });
  } catch (error) {
    console.error("Error en resolveShareToken:", error);
    throw new Error(typeof error === "string" ? error : "Link inválido o expirado");
  }
}

/** * Extrae el token de una URL o valida si el input ya es un token.
 */
export function extractShareTokenFromUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Intenta extraer de una URL tipo https://.../share/abc123
  const match = trimmed.match(/\/share\/([a-f0-9]+)/i);
  if (match) return match[1];

  // Si parece ser un token directo (ej: 48 caracteres hex)
  if (/^[a-f0-9]{48}$/i.test(trimmed)) return trimmed;

  return null;
}
