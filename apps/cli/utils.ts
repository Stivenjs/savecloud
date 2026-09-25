/**
 * En Windows, si el proceso termina sin terminal abierta (doble clic al exe),
 * esperar Enter para que el usuario pueda leer la salida.
 */
export async function waitForKeypressOnWindowsIfNeeded(): Promise<void> {
  if (process.platform !== "win32" || !process.stdin.isTTY) return;
  console.log("Pulsa Enter para salir...");
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
    process.stdin.resume();
  });
}

/**
 * Convierte un nombre legible a game-id: minúsculas, guiones, sin caracteres especiales.
 */
export function toGameId(folderName: string): string {
  return folderName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Formatea bytes en formato legible (B, KB, MB).
 */
export function formatSize(bytes?: number): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Indica si el error es una salida intencional del usuario (Ctrl+C, etc.).
 */
export function isExitPromptError(err: unknown): boolean {
  if (err && typeof (err as { name: string }).name === "string") {
    const name = (err as { name: string }).name;
    return name === "ExitPromptError" || name === "User force closed";
  }
  return false;
}
