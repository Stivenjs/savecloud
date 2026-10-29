import { ApplicationError } from "@application/errors/ApplicationError";

/**
 * Valida que un `gameId` y `filename` no contengan secuencias de escape
 * o path traversal hacia directorios superiores (`..`), barras iniciales absolutas, etc.
 *
 * @param gameId - Identificador del juego (no debe contener barras ni `..`).
 * @param filename - Nombre relativo del archivo en el juego (no debe contener `..` ni iniciar con `/`).
 * @throws {ApplicationError} Si los parámetros contienen caracteres de path traversal.
 */
export function assertSafeSavePath(gameId: string, filename: string): void {
  const trimmedGameId = gameId?.trim() ?? "";
  const trimmedFilename = filename?.trim() ?? "";

  if (
    !trimmedGameId ||
    !trimmedFilename ||
    trimmedGameId.includes("..") ||
    trimmedGameId.includes("/") ||
    trimmedGameId.includes("\\") ||
    trimmedFilename.includes("..") ||
    trimmedFilename.startsWith("/") ||
    trimmedFilename.startsWith("\\")
  ) {
    throw new ApplicationError(
      "INVALID_ARGUMENT",
      "El identificador del juego o el nombre de archivo contiene rutas no permitidas."
    );
  }
}

/**
 * Valida que una clave de almacenamiento (`key`) pertenezca estrictamente
 * al espacio de nombres del usuario y juego solicitados (`${userId}/${gameId}/`),
 * garantizando el aislamiento multi-tenant y previniendo path traversal.
 *
 * @param userId - Identificador del usuario propietario.
 * @param gameId - Identificador del juego.
 * @param key - Clave completa del objeto en almacenamiento.
 * @throws {ApplicationError} Si la clave no coincide con el prefijo esperado o contiene `..`.
 */
export function assertSafeKeyPrefix(userId: string, gameId: string, key: string): void {
  const trimmedUserId = userId?.trim() ?? "";
  const trimmedGameId = gameId?.trim() ?? "";
  const trimmedKey = key?.trim() ?? "";
  const expectedPrefix = `${trimmedUserId}/${trimmedGameId}/`;

  if (!trimmedKey.startsWith(expectedPrefix) || trimmedKey.includes("..")) {
    throw new ApplicationError(
      "INVALID_ARGUMENT",
      `La clave '${trimmedKey}' no pertenece al usuario y juego solicitados.`
    );
  }
}
