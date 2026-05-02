import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export const SETTINGS_WINDOW_LABEL = "settings-window";

export async function openOrFocusSettingsWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(SETTINGS_WINDOW_LABEL);
  if (existing) {
    await existing.show();
    await existing.setFocus();
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
  });

  settingsWindow.once("tauri://created", async () => {
    await settingsWindow.show();
    await settingsWindow.setFocus();
  });

  settingsWindow.once("tauri://error", (event) => {
    console.error("[SettingsWindow] Error creando ventana:", event);
  });
}

export async function focusMainWindow(): Promise<void> {
  const mainWindow = await WebviewWindow.getByLabel("main");
  if (!mainWindow) return;
  await mainWindow.show();
  await mainWindow.setFocus();
}
