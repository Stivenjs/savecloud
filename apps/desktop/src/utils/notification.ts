import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { formatPlaytime } from "@utils/format";
import i18n from "@lib/i18n";

/** Título de las notificaciones por defecto. */
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
    title: i18n.t("notifications.defaultTitle", NOTIFICATION_TITLE),
    body: i18n.t("notifications.uploadDone", { gameName, defaultValue: `${gameName}: subida completada` }),
  }));
}

/**
 * Notificación cuando termina una descarga manual (un juego).
 */
export async function notifyDownloadDone(gameName: string): Promise<void> {
  await maybeNotify(() => ({
    title: i18n.t("notifications.defaultTitle", NOTIFICATION_TITLE),
    body: i18n.t("notifications.downloadDone", { gameName, defaultValue: `${gameName}: descarga completada` }),
  }));
}

/**
 * Notificación cuando termina un backup completo (empaquetado/streaming).
 */
export async function notifyFullBackupDone(gameName: string): Promise<void> {
  await maybeNotify(() => ({
    title: i18n.t("notifications.defaultTitle", NOTIFICATION_TITLE),
    body: i18n.t("notifications.fullBackupDone", { gameName, defaultValue: `${gameName}: backup completo subido` }),
  }));
}

/**
 * Notificación cuando termina una prueba de streaming TAR (dry-run).
 */
export async function notifyStreamingDryRunDone(
  gameName: string,
  savedFormatted: string,
  savedPercentage: number
): Promise<void> {
  await maybeNotify(() => ({
    title: i18n.t("notifications.streamingDryRunTitle", "SaveCloud - Modo Prueba"),
    body: i18n.t("notifications.streamingDryRunBody", {
      gameName,
      savedFormatted,
      savedPercentage: savedPercentage.toFixed(1),
      defaultValue: `${gameName}: prueba completada (ahorro: ${savedFormatted} / ${savedPercentage.toFixed(1)}%)`,
    }),
  }));
}

/**
 * Notificación cuando falla una subida.
 */
export async function notifyUploadError(gameName: string, error: string): Promise<void> {
  await maybeNotify(() => ({
    title: i18n.t("notifications.errorTitle", NOTIFICATION_TITLE_ERROR),
    body: i18n.t("notifications.uploadError", {
      gameName,
      error,
      defaultValue: `${gameName}: error al subir — ${error}`,
    }),
  }));
}

/**
 * Notificación cuando falla una descarga.
 */
export async function notifyDownloadError(gameName: string, error: string): Promise<void> {
  await maybeNotify(() => ({
    title: i18n.t("notifications.errorTitle", NOTIFICATION_TITLE_ERROR),
    body: i18n.t("notifications.downloadError", {
      gameName,
      error,
      defaultValue: `${gameName}: error al descargar — ${error}`,
    }),
  }));
}

/**
 * Notificación cuando falla un backup completo.
 */
export async function notifyFullBackupError(gameName: string, error: string): Promise<void> {
  await maybeNotify(() => ({
    title: i18n.t("notifications.errorTitle", NOTIFICATION_TITLE_ERROR),
    body: i18n.t("notifications.fullBackupError", {
      gameName,
      error,
      defaultValue: `${gameName}: error al empaquetar/subir — ${error}`,
    }),
  }));
}

/**
 * Notificación al terminar "subir todos" (batch).
 */
export async function notifyBatchUploadDone(okCount: number, errCount: number): Promise<void> {
  await maybeNotify(() => {
    if (errCount === 0) {
      return {
        title: i18n.t("notifications.defaultTitle", NOTIFICATION_TITLE),
        body: i18n.t("notifications.batchUploadSuccess", {
          count: okCount,
          defaultValue: `Subida completada: ${okCount} archivo(s) a la nube`,
        }),
      };
    }
    if (okCount > 0) {
      return {
        title: i18n.t("notifications.defaultTitle", NOTIFICATION_TITLE),
        body: i18n.t("notifications.batchUploadPartial", {
          okCount,
          errCount,
          defaultValue: `Subida completada con errores: ${okCount} subido(s), ${errCount} error(es)`,
        }),
      };
    }
    return {
      title: i18n.t("notifications.errorTitle", NOTIFICATION_TITLE_ERROR),
      body: i18n.t("notifications.batchUploadFailed", "Subida fallida"),
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
        title: i18n.t("notifications.defaultTitle", NOTIFICATION_TITLE),
        body: i18n.t("notifications.batchDownloadSuccess", {
          count: okCount,
          defaultValue: `Descarga completada: ${okCount} archivo(s)`,
        }),
      };
    }
    if (okCount > 0) {
      return {
        title: i18n.t("notifications.defaultTitle", NOTIFICATION_TITLE),
        body: i18n.t("notifications.batchDownloadPartial", {
          okCount,
          errCount,
          defaultValue: `Descarga completada con errores: ${okCount} descargado(s), ${errCount} error(es)`,
        }),
      };
    }
    return {
      title: i18n.t("notifications.errorTitle", NOTIFICATION_TITLE_ERROR),
      body: i18n.t("notifications.batchDownloadFailed", "Descarga fallida"),
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
        title: i18n.t("notifications.defaultTitle", NOTIFICATION_TITLE),
        body: i18n.t("notifications.syncCompleteSuccess", {
          gameName,
          count: okCount,
          defaultValue: `${gameName}: ${okCount} archivo(s) subido(s) a la nube`,
        }),
      };
    }
    if (okCount > 0) {
      return {
        title: i18n.t("notifications.defaultTitle", NOTIFICATION_TITLE),
        body: i18n.t("notifications.syncCompletePartial", {
          gameName,
          okCount,
          errCount,
          defaultValue: `${gameName}: ${okCount} subido(s), ${errCount} error(es)`,
        }),
      };
    }
    return {
      title: i18n.t("notifications.errorTitle", NOTIFICATION_TITLE_ERROR),
      body: i18n.t("notifications.syncCompleteFailed", {
        gameName,
        defaultValue: `${gameName}: No se pudo subir`,
      }),
    };
  });
}

/**
 * Resumen semanal de tiempo de juego (solo si la app está en segundo plano).
 */
export async function notifyWeeklyDigest(weeklyPlaytimeSeconds: number): Promise<void> {
  await maybeNotify(() => ({
    title: i18n.t("notifications.defaultTitle", NOTIFICATION_TITLE),
    body: i18n.t("notifications.weeklyDigest", {
      playtime: formatPlaytime(weeklyPlaytimeSeconds),
      defaultValue: `Esta semana: ${formatPlaytime(weeklyPlaytimeSeconds)} jugados.`,
    }),
  }));
}

/**
 * Envía una notificación de prueba (útil para verificar permisos).
 */
export async function notifyTest(): Promise<boolean> {
  const granted = await ensurePermission();
  if (!granted) return false;
  sendNotification({
    title: i18n.t("notifications.testTitle", NOTIFICATION_TITLE),
    body: i18n.t("notifications.testBody", "Notificación de prueba — si ves esto, todo funciona correctamente"),
  });
  return true;
}

/**
 * Notificación cuando hay error en la subida automática (solo si app en segundo plano).
 */
export async function notifySyncError(gameName: string, error: string): Promise<void> {
  await maybeNotify(() => ({
    title: i18n.t("notifications.errorTitle", NOTIFICATION_TITLE_ERROR),
    body: i18n.t("notifications.syncError", {
      gameName,
      error,
      defaultValue: `${gameName}: ${error}`,
    }),
  }));
}
