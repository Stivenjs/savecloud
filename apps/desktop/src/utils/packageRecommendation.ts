/**
 * Umbrales para recomendar "Empaquetar y subir" en lugar de subir archivo a archivo.
 * Por encima de estos valores la subida empaquetada suele ser más rápida y estable.
 */
export const PACKAGE_RECOMMEND_MIN_FILES = 300;
export const PACKAGE_RECOMMEND_MIN_BYTES = 400 * 1024 * 1024; // 400 MB

/**
 * Umbrales para PROHIBIR subida archivo a archivo. Por encima de estos valores
 * el usuario debe usar "Empaquetar y subir" obligatoriamente.
 */
export const LARGE_GAME_BLOCK_FILE_COUNT = 200;
export const LARGE_GAME_BLOCK_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB

/** Indica si un juego es demasiado grande para subir archivo a archivo (debe empaquetar). */
export function isGameTooLargeForSync(fileCount: number, totalBytes: number): boolean {
  return fileCount >= LARGE_GAME_BLOCK_FILE_COUNT || totalBytes >= LARGE_GAME_BLOCK_SIZE_BYTES;
}

export interface PackageRecommendation {
  recommend: boolean;
  reason: string;
}

/**
 * Indica si conviene recomendar empaquetar para una subida, según número de archivos y/o tamaño.
 * Usado en la vista previa de subir un solo juego.
 */
export function getPackageRecommendation(fileCount: number, totalBytes: number): PackageRecommendation {
  const overFiles = fileCount >= PACKAGE_RECOMMEND_MIN_FILES;
  const overSize = totalBytes >= PACKAGE_RECOMMEND_MIN_BYTES;
  if (overFiles && overSize) {
    return {
      recommend: true,
      reason: `Este juego tiene muchos archivos (${fileCount}) y mucho peso (${formatMb(
        totalBytes
      )} MB). Te recomendamos empaquetar y subir para ir más rápido.`,
    };
  }
  if (overFiles) {
    return {
      recommend: true,
      reason: `Este juego tiene muchos archivos (${fileCount}). Te recomendamos empaquetar y subir para ir más rápido.`,
    };
  }
  if (overSize) {
    return {
      recommend: true,
      reason: `Este juego pesa bastante (${formatMb(
        totalBytes
      )} MB). Te recomendamos empaquetar y subir para ir más rápido.`,
    };
  }
  return { recommend: false, reason: "" };
}

function formatMb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/**
 * Cuenta cuántos juegos superan el umbral de tamaño (para mostrar en "Subir todos").
 * statsByGameId puede no tener entrada para todos los juegos.
 */
export function countGamesOverSizeThreshold(
  gameIds: string[],
  statsByGameId: Map<string, { localSizeBytes: number }>
): number {
  return gameIds.filter((id) => {
    const stats = statsByGameId.get(id);
    return (stats?.localSizeBytes ?? 0) >= PACKAGE_RECOMMEND_MIN_BYTES;
  }).length;
}
