import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { formatPlaytime } from "@utils/format";

/** Título de las notificaciones (cambiar aquí para todas). */
export const NOTIFICATION_TITLE = "SaveCloud";
/** Título de las notificaciones de error. */
export const NOTIFICATION_TITLE_ERROR = "SaveCloud: Error";

let permissionChecked = false;

async function ensurePermission(): Promise<boolean> {
  if (permissionChecked) {
    return isPermissionGranted();
  }
  const granted = await isPermissionGranted();
  if (granted) {
    permissionChecked = true;
    return true;
  }
  const result = await requestPermission();
  permissionChecked = true;
  return result === "granted";
}

/**
 * True si la app no está a la vista: documento oculto (pestaña/ventana minimizada)
 * o ventana de Tauri sin foco (otra app delante).
 * Así las notificaciones se muestran cuando el usuario no está mirando la app.
 */
export async function isAppInBackground(): Promise<boolean> {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return true;
  }
  try {
    const win = getCurrentWindow();
    const focused = await win.isFocused();
    return !focused;
  } catch {
    return false;
  }
}

/** Solo envía notificación si tenemos permiso y la app está en segundo plano. */
async function maybeNotify(build: () => { title: string; body: string }): Promise<void> {
  if (!(await isAppInBackground())) return;
  if (!(await ensurePermission())) return;
  const { title, body } = build();
  sendNotification({ title, body });
}

/**
 * Notificación cuando termina una subida manual (un juego).
 */
export async function notifyUploadDone(gameName: string): Promise<void> {
  await maybeNotify(() => ({
    title: NOTIFICATION_TITLE,
    body: `${gameName}: subida completada`,
  }));
}

/**
 * Notificación cuando termina una descarga manual (un juego).
 */
export async function notifyDownloadDone(gameName: string): Promise<void> {
  await maybeNotify(() => ({
    title: NOTIFICATION_TITLE,
    body: `${gameName}: descarga completada`,
  }));
}

/**
 * Notificación cuando termina un backup completo (empaquetado/streaming).
 */
export async function notifyFullBackupDone(gameName: string): Promise<void> {
  await maybeNotify(() => ({
    title: NOTIFICATION_TITLE,
    body: `${gameName}: backup completo subido`,
  }));
}

/**
 * Notificación cuando falla una subida.
 */
export async function notifyUploadError(gameName: string, error: string): Promise<void> {
  await maybeNotify(() => ({
    title: NOTIFICATION_TITLE_ERROR,
    body: `${gameName}: error al subir — ${error}`,
  }));
}

/**
 * Notificación cuando falla una descarga.
 */
export async function notifyDownloadError(gameName: string, error: string): Promise<void> {
  await maybeNotify(() => ({
    title: NOTIFICATION_TITLE_ERROR,
    body: `${gameName}: error al descargar — ${error}`,
  }));
}

/**
 * Notificación cuando falla un backup completo.
 */
export async function notifyFullBackupError(gameName: string, error: string): Promise<void> {
  await maybeNotify(() => ({
    title: NOTIFICATION_TITLE_ERROR,
    body: `${gameName}: error al empaquetar/subir — ${error}`,
  }));
}

/**
 * Notificación al terminar "subir todos" (batch).
 */
export async function notifyBatchUploadDone(okCount: number, errCount: number): Promise<void> {
  await maybeNotify(() => {
    if (errCount === 0) {
      return {
        title: NOTIFICATION_TITLE,
        body: `Subida completada: ${okCount} archivo(s) a la nube`,
      };
    }
    if (okCount > 0) {
      return {
        title: NOTIFICATION_TITLE,
        body: `Subida completada con errores: ${okCount} subido(s), ${errCount} error(es)`,
      };
    }
    return {
      title: NOTIFICATION_TITLE_ERROR,
      body: "Subida fallida",
    };
  });
}

/**
 * Notificación al terminar "descargar todos" (batch).
 */
export async function notifyBatchDownloadDone(okCount: number, errCount: number): Promise<void> {
  await maybeNotify(() => {
    if (errCount === 0) {
      return {
        title: NOTIFICATION_TITLE,
        body: `Descarga completada: ${okCount} archivo(s)`,
      };
    }
    if (okCount > 0) {
      return {
        title: NOTIFICATION_TITLE,
        body: `Descarga completada con errores: ${okCount} descargado(s), ${errCount} error(es)`,
      };
    }
    return {
      title: NOTIFICATION_TITLE_ERROR,
      body: "Descarga fallida",
    };
  });
}

/**
 * Muestra una notificación de sistema para sync automático (solo si app en segundo plano).
 */
export async function notifySyncComplete(gameName: string, okCount: number, errCount: number): Promise<void> {
  await maybeNotify(() => {
    if (errCount === 0) {
      return {
        title: NOTIFICATION_TITLE,
        body: `${gameName}: ${okCount} archivo(s) subido(s) a la nube`,
      };
    }
    if (okCount > 0) {
      return {
        title: NOTIFICATION_TITLE,
        body: `${gameName}: ${okCount} subido(s), ${errCount} error(es)`,
      };
    }
    return {
      title: NOTIFICATION_TITLE_ERROR,
      body: `${gameName}: No se pudo subir`,
    };
  });
}

/**
 * Resumen semanal de tiempo de juego (solo si la app está en segundo plano).
 */
export async function notifyWeeklyDigest(weeklyPlaytimeSeconds: number): Promise<void> {
  await maybeNotify(() => ({
    title: NOTIFICATION_TITLE,
    body: `Esta semana: ${formatPlaytime(weeklyPlaytimeSeconds)} jugados.`,
  }));
}

/**
 * Envía una notificación de prueba (útil para verificar permisos).
 */
export async function notifyTest(): Promise<boolean> {
  const granted = await ensurePermission();
  if (!granted) return false;
  sendNotification({
    title: NOTIFICATION_TITLE,
    body: "Notificación de prueba — si ves esto, todo funciona correctamente",
  });
  return true;
}

/**
 * Notificación cuando hay error en la subida automática (solo si app en segundo plano).
 */
export async function notifySyncError(gameName: string, error: string): Promise<void> {
  await maybeNotify(() => ({
    title: NOTIFICATION_TITLE_ERROR,
    body: `${gameName}: ${error}`,
  }));
}
