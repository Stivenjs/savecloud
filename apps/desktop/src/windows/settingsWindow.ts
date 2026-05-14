import { emitTo } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  SAVECLOUD_SETTINGS_SELECT_TAB_EVENT,
  type SavecloudSettingsSelectTabPayload,
} from "@/constants/savecloudCrossWindow";
import type { SettingsTabKey } from "@features/settings/SettingsSidebar";
import { resolveExistingWebviewWindow, showCenteredAndFocus } from "@/windows/webviewRecovery";

export const SETTINGS_WINDOW_LABEL = "settings-window";

/** Sincroniza cromo (barra de título) en la webview de ajustes; el nombre cumple reglas de Tauri. */
export const SAVECLOUD_SETTINGS_CHROME_EVENT = "savecloud-settings-chrome";

export type SavecloudSettingsChromePayload = {
  hideTitleBar: boolean;
};

export type OpenSettingsWindowOptions = {
  /** true cuando la ventana se abre o enfoca desde Big Picture (sin title bar). */
  launchedFromBigPicture?: boolean;
  /** Pestaña inicial al crear o al enfocar la ventana de ajustes. */
  initialTab?: SettingsTabKey;
};

async function syncSettingsWindowChrome(hideTitleBar: boolean): Promise<void> {
  try {
    await emitTo(SETTINGS_WINDOW_LABEL, SAVECLOUD_SETTINGS_CHROME_EVENT, { hideTitleBar });
  } catch {
    /* la webview puede no estar montada aún */
  }
}

/** Llama al salir de Big Picture o cerrar su ventana: vuelve a mostrar la barra de título en Ajustes. */
export async function restoreSettingsWindowTitleBarAfterBigPicture(): Promise<void> {
  await syncSettingsWindowChrome(false);
}

/**
 * Desde Big Picture: si la ventana de Ajustes ya existe y está visible la oculta;
 * si está oculta o no existe, la muestra o crea como `openOrFocusSettingsWindow`.
 */
export async function toggleSettingsWindowFromBigPicture(): Promise<void> {
  const existing = await resolveExistingWebviewWindow(SETTINGS_WINDOW_LABEL);
  if (existing) {
    try {
      if (await existing.isVisible()) {
        await existing.hide();
        return;
      }
    } catch {
      /* mostrar enfocado */
    }
    await showCenteredAndFocus(existing);
    await syncSettingsWindowChrome(true);
    return;
  }
  await openOrFocusSettingsWindow({ launchedFromBigPicture: true });
}

export async function openOrFocusSettingsWindow(options?: OpenSettingsWindowOptions): Promise<void> {
  const fromBigPicture = options?.launchedFromBigPicture === true;
  const tabQs = options?.initialTab ? `&tab=${encodeURIComponent(options.initialTab)}` : "";
  const existing = await resolveExistingWebviewWindow(SETTINGS_WINDOW_LABEL);
  if (existing) {
    await showCenteredAndFocus(existing);
    await syncSettingsWindowChrome(fromBigPicture);
    if (options?.initialTab) {
      try {
        await emitTo(SETTINGS_WINDOW_LABEL, SAVECLOUD_SETTINGS_SELECT_TAB_EVENT, {
          tab: options.initialTab,
        } as SavecloudSettingsSelectTabPayload);
      } catch {
        /* webview aún no escucha */
      }
    }
    return;
  }

  const settingsUrl = `/?settingsWindow=true${fromBigPicture ? "&bpSettings=1" : ""}${tabQs}`;

  const settingsWindow = new WebviewWindow(SETTINGS_WINDOW_LABEL, {
    title: "Ajustes",
    width: 1160,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    url: settingsUrl,
    resizable: true,
    decorations: false,
    transparent: true,
    visible: false,
    center: true,
  });

  settingsWindow.once("tauri://created", async () => {
    await settingsWindow.show();
    await settingsWindow.setFocus();
  });

  settingsWindow.once("tauri://error", async (event) => {
    console.error("[SettingsWindow] Error creando ventana:", event);
    const recovered = await resolveExistingWebviewWindow(SETTINGS_WINDOW_LABEL);
    if (recovered) {
      await showCenteredAndFocus(recovered);
      await syncSettingsWindowChrome(fromBigPicture);
    }
  });
}
