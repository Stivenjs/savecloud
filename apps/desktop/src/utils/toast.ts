import { sileo, type SileoOptions } from "sileo";
import { formatGameDisplayName } from "@/utils/gameImage";
import type { SyncResult } from "@services/tauri";

export interface ToastOptions {
  /** Duración en ms antes de cerrar el toast. */
  timeout?: number;
  /** @deprecated Opciones de HeroUI; ignoradas con Sileo. */
  color?: string;
  /** @deprecated Opciones de HeroUI; ignoradas con Sileo. */
  classNames?: Record<string, string>;
}

type SileoToastFn = (opts: SileoOptions) => string;

const STATE_TITLE_CLASS = {
  success: "!text-success-600 dark:!text-success-400",
  error: "!text-danger-600 dark:!text-danger-400",
  warning: "!text-warning-600 dark:!text-warning-400",
  info: "!text-primary-600 dark:!text-primary-400",
} as const;

function showToast(
  emit: SileoToastFn,
  state: keyof typeof STATE_TITLE_CLASS,
  title: string,
  description?: string,
  options?: ToastOptions
): void {
  const { timeout, color: _color, classNames: _classNames } = options ?? {};
  emit({
    title,
    ...(description ? { description } : {}),
    ...(timeout !== undefined ? { duration: timeout } : {}),
    styles: { title: STATE_TITLE_CLASS[state] },
  });
}

/**
 * Muestra un toast de éxito.
 */
export function toastSuccess(title: string, description?: string, options?: ToastOptions): void {
  showToast(sileo.success, "success", title, description, { timeout: 5000, ...options });
}

/**
 * Muestra un toast de error.
 */
export function toastError(title: string, description?: string, options?: ToastOptions): void {
  showToast(sileo.error, "error", title, description, { timeout: 8000, ...options });
}

/**
 * Muestra un toast de advertencia.
 */
export function toastWarning(title: string, description?: string, options?: ToastOptions): void {
  showToast(sileo.warning, "warning", title, description, { timeout: 7000, ...options });
}

/**
 * Muestra un toast de información.
 */
export function toastInfo(title: string, description?: string, options?: ToastOptions): void {
  showToast(sileo.info, "info", title, description, { timeout: 6000, ...options });
}

/**
 * Muestra el toast adecuado según el resultado de una descarga.
 */
export function toastDownloadResult(result: SyncResult, gameName?: string): void {
  if (result.errCount === 0 && result.okCount > 0) {
    toastSuccess(
      "Descarga completada",
      gameName
        ? `${formatGameDisplayName(gameName)}: ${result.okCount} archivo(s) descargado(s)`
        : `${result.okCount} archivo(s) descargado(s)`
    );
  } else if (result.errCount === 0 && result.okCount === 0) {
    toastInfo("Sin guardados en la nube", result.errors[0] ?? "No hay guardados de este juego");
  } else if (result.okCount > 0) {
    toastWarning("Descarga parcial", `${result.okCount} descargado(s), ${result.errCount} error(es)`);
  } else {
    toastError("Error en la descarga", result.errors[0] ?? "No se pudo descargar");
  }
}

/**
 * Muestra el toast adecuado según el resultado de una sincronización (subida).
 */
export function toastSyncResult(result: SyncResult, gameName?: string): void {
  if (result.errCount === 0 && result.okCount > 0) {
    toastSuccess(
      "Sincronización completada",
      gameName
        ? `${formatGameDisplayName(gameName)}: ${result.okCount} archivo(s) subido(s)`
        : `${result.okCount} archivo(s) subido(s)`
    );
  } else if (result.errCount === 0 && result.okCount === 0) {
    toastInfo("Sin cambios en la sincronización", result.errors[0] ?? "No se encontraron archivos para sincronizar");
  } else if (result.okCount > 0) {
    toastWarning("Sincronización parcial", `${result.okCount} subido(s), ${result.errCount} error(es)`);
  } else {
    toastError("Error en la sincronización", result.errors[0] ?? "No se pudo subir");
  }
}
