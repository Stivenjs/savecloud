import { addToast } from "@heroui/react";
import type { SyncResult } from "@services/tauri";

type ToastColor = "default" | "primary" | "secondary" | "success" | "warning" | "danger";

type AddToastInput = Parameters<typeof addToast>[0];
type ToastClassNames = NonNullable<AddToastInput["classNames"]>;

interface ToastOptions {
  timeout?: number;
  /** @deprecated Prefer no usar: los toasts usan fondo neutro y color solo en título/icono. */
  color?: ToastColor;
  classNames?: ToastClassNames;
}

function mergeClassNames(a: ToastClassNames | undefined, b: ToastClassNames | undefined): ToastClassNames | undefined {
  if (!a && !b) return undefined;
  if (!b) return a;
  if (!a) return b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof ToastClassNames)[]);
  const out: Record<string, string> = {};
  for (const k of keys) {
    const va = a[k];
    const vb = b[k];
    const sa = typeof va === "string" ? va : "";
    const sb = typeof vb === "string" ? vb : "";
    if (sa && sb) out[k as string] = `${sa} ${sb}`;
    else out[k as string] = sa || sb;
  }
  return out as ToastClassNames;
}

/** Fondo neutro opaco; el estado se ve en icono + título, descripción en gris legible. */
const baseShell: ToastClassNames = {
  base: "border border-default-200/90 bg-background shadow-md ring-1 ring-black/5 dark:border-default-100/25 dark:bg-default-100 dark:ring-white/10",
  title: "truncate font-semibold",
  description: "break-words text-sm font-normal leading-snug text-default-600 dark:text-default-400",
  content: "items-start gap-3",
  icon: "mt-0.5 shrink-0",
  closeButton: "text-default-400 hover:text-default-600",
};

const successToast: Partial<AddToastInput> = {
  color: "default",
  variant: "flat",
  severity: "success",
  classNames: mergeClassNames(baseShell, {
    title: "text-success-600 dark:text-success-400",
    icon: "text-success-500 dark:text-success-400",
  }),
};

const dangerToast: Partial<AddToastInput> = {
  color: "default",
  variant: "flat",
  severity: "danger",
  classNames: mergeClassNames(baseShell, {
    title: "text-danger-600 dark:text-danger-400",
    icon: "text-danger-500 dark:text-danger-400",
  }),
};

const warningToast: Partial<AddToastInput> = {
  color: "default",
  variant: "flat",
  severity: "warning",
  classNames: mergeClassNames(baseShell, {
    title: "text-warning-600 dark:text-warning-400",
    icon: "text-warning-500 dark:text-warning-400",
  }),
};

const infoToast: Partial<AddToastInput> = {
  color: "default",
  variant: "flat",
  severity: "primary",
  classNames: mergeClassNames(baseShell, {
    title: "text-primary-600 dark:text-primary-400",
    icon: "text-primary-500 dark:text-primary-400",
  }),
};

/**
 * Muestra un toast de éxito: título e icono en verde, descripción en texto normal.
 */
export function toastSuccess(title: string, description?: string, options?: ToastOptions): void {
  const { timeout = 5000, classNames, color: _legacyColor, ...rest } = options ?? {};
  addToast({
    ...successToast,
    ...rest,
    title,
    description,
    timeout,
    classNames: mergeClassNames(successToast.classNames, classNames),
  });
}

/**
 * Muestra un toast de error: título e icono en rojo, descripción en texto normal.
 */
export function toastError(title: string, description?: string, options?: ToastOptions): void {
  const { timeout = 8000, classNames, color: _legacyColor, ...rest } = options ?? {};
  addToast({
    ...dangerToast,
    ...rest,
    title,
    description,
    timeout,
    classNames: mergeClassNames(dangerToast.classNames, classNames),
  });
}

/**
 * Muestra un toast de advertencia: título e icono en ámbar, descripción en texto normal.
 */
export function toastWarning(title: string, description?: string, options?: ToastOptions): void {
  const { timeout = 7000, classNames, color: _legacyColor, ...rest } = options ?? {};
  addToast({
    ...warningToast,
    ...rest,
    title,
    description,
    timeout,
    classNames: mergeClassNames(warningToast.classNames, classNames),
  });
}

/**
 * Muestra un toast de información: título e icono en primario, descripción en texto normal.
 */
export function toastInfo(title: string, description?: string, options?: ToastOptions): void {
  const { timeout = 6000, classNames, color: _legacyColor, ...rest } = options ?? {};
  addToast({
    ...infoToast,
    ...rest,
    title,
    description,
    timeout,
    classNames: mergeClassNames(infoToast.classNames, classNames),
  });
}

/**
 * Muestra el toast adecuado según el resultado de una descarga.
 * @param result - Resultado de syncDownloadGame
 * @param gameName - Nombre formateado del juego (opcional, para un solo juego)
 */
export function toastDownloadResult(result: SyncResult, gameName?: string): void {
  if (result.errCount === 0 && result.okCount > 0) {
    toastSuccess(
      "Descarga completada",
      gameName
        ? `${gameName}: ${result.okCount} archivo(s) descargado(s)`
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
 * @param result - Resultado de syncUploadGame
 * @param gameName - Nombre formateado del juego (opcional, para un solo juego)
 */
export function toastSyncResult(result: SyncResult, gameName?: string): void {
  if (result.errCount === 0 && result.okCount > 0) {
    toastSuccess(
      "Sincronización completada",
      gameName ? `${gameName}: ${result.okCount} archivo(s) subido(s)` : `${result.okCount} archivo(s) subido(s)`
    );
  } else if (result.errCount === 0 && result.okCount === 0) {
    toastInfo("Sin cambios en la sincronización", result.errors[0] ?? "No se encontraron archivos para sincronizar");
  } else if (result.okCount > 0) {
    toastWarning("Sincronización parcial", `${result.okCount} subido(s), ${result.errCount} error(es)`);
  } else {
    toastError("Error en la sincronización", result.errors[0] ?? "No se pudo subir");
  }
}
