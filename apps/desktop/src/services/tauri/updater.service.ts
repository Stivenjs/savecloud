import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ask } from "@tauri-apps/plugin-dialog";
import { toastError, toastInfo, toastSuccess } from "@utils/toast";

export type UpdateCheckResult =
  | { ok: true; hasUpdate: false }
  | { ok: true; hasUpdate: true; version: string; body?: string }
  | { ok: false; error: string };

/**
 * El plugin de Tauri devuelve esto cuando el endpoint responde pero el JSON de release
 * no es válido o aún no está publicado (p. ej. GitHub Actions subiendo `latest.json`).
 * No es un fallo grave de la app: conviene reintentar más tarde.
 */
function isTransientUpdaterReleaseMetadataError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("valid release json") ||
    m.includes("could not fetch a valid release") ||
    (m.includes("could not fetch") && m.includes("release") && m.includes("json"))
  );
}

const TRANSIENT_UPDATE_USER_MESSAGE =
  "El servidor de actualizaciones aún no tiene la información de esta versión (suele ocurrir mientras se publica una release). Vuelve a intentarlo en unos minutos.";

/**
 * Comprueba si hay actualizaciones disponibles.
 * Devuelve el resultado sin mostrar diálogos (útil para comprobar al inicio).
 */
export async function checkForUpdatesSilent(): Promise<UpdateCheckResult> {
  try {
    const update = await check();
    if (!update) {
      return { ok: true, hasUpdate: false };
    }
    return {
      ok: true,
      hasUpdate: true,
      version: update.version,
      body: update.body,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isTransientUpdaterReleaseMetadataError(msg)) {
      return { ok: true, hasUpdate: false };
    }
    return { ok: false, error: msg };
  }
}

/**
 * Comprueba actualizaciones, muestra diálogo si hay una disponible
 * y ofrece descargar e instalar.
 * @param silentWhenUpToDate - Si true, no muestra toast cuando no hay actualización (útil al iniciar la app).
 */
export async function checkForUpdatesWithPrompt(silentWhenUpToDate = false): Promise<void> {
  try {
    const update = await check();
    if (!update) {
      if (!silentWhenUpToDate) {
        toastInfo("Ya tienes la última versión");
      }
      return;
    }

    const notes = update.body?.trim() || "Mejoras y correcciones.";
    const message = `Nueva versión ${update.version} disponible.\n\n${notes}\n\n¿Descargar e instalar ahora?`;

    const shouldUpdate = await ask(message, {
      title: "Actualización disponible",
      kind: "info",
      okLabel: "Actualizar",
      cancelLabel: "Más tarde",
    });

    if (!shouldUpdate) return;

    await update.downloadAndInstall((event) => {
      if (event.event === "Started" && event.data.contentLength) {
        console.log(`Descargando actualización: ${event.data.contentLength} bytes`);
      } else if (event.event === "Progress") {
        // Opcional: mostrar progreso en UI
      } else if (event.event === "Finished") {
        console.log("Descarga completada");
      }
    });

    toastSuccess("Actualización instalada", "La aplicación se reiniciará ahora.");
    await relaunch();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isTransientUpdaterReleaseMetadataError(msg)) {
      if (!silentWhenUpToDate) {
        toastInfo("No se pudo comprobar la actualización", TRANSIENT_UPDATE_USER_MESSAGE);
      }
      return;
    }
    toastError("Error al buscar actualizaciones", msg);
  }
}
