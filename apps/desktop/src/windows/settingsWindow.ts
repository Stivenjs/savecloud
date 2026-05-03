import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { resolveExistingWebviewWindow, showCenteredAndFocus } from "@/windows/webviewRecovery";

export const SETTINGS_WINDOW_LABEL = "settings-window";

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
    return;
  }
  await openOrFocusSettingsWindow();
}

export async function openOrFocusSettingsWindow(): Promise<void> {
  const existing = await resolveExistingWebviewWindow(SETTINGS_WINDOW_LABEL);
  if (existing) {
    await showCenteredAndFocus(existing);
    return;
  }

  const settingsWindow = new WebviewWindow(SETTINGS_WINDOW_LABEL, {
    title: "Ajustes",
    width: 1160,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    url: "/?settingsWindow=true",
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
    }
  });
}
