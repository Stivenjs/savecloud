/**
 * @fileoverview Tipos para la gestión de la papelera de reciclaje (Trash / Soft Delete).
 *
 * @module types/trash
 */

/**
 * Archivo individual almacenado dentro de la papelera de reciclaje.
 */
export interface TrashFileItem {
  /** Nombre relativo del archivo (ej. "save01.dat" o "backups/2026-08-29.tar") */
  filename: string;
  /** Tamaño del archivo en bytes */
  size: number;
  /** Fecha en formato ISO de la última modificación o creación */
  lastModified: string;
}

/**
 * Entrada agrupada de un juego en la papelera de reciclaje.
 */
export interface TrashGameItem {
  /** Identificador único del juego */
  gameId: string;
  /** Cantidad total de archivos de guardado o backups en la papelera */
  totalFiles: number;
  /** Tamaño total acumulado en bytes */
  totalSizeBytes: number;
  /** Fecha en formato ISO en que fue enviado a la papelera */
  deletedAt: string;
  /** Fecha estimada de expiración y purga definitiva automática por política de ciclo de vida */
  expiresAt: string;
  /** Lista detallada de archivos contenidos */
  files: TrashFileItem[];
}
