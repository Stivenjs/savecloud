import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export async function focusMainWindow(): Promise<void> {
  const mainWindow = await WebviewWindow.getByLabel("main");
  if (!mainWindow) return;
  await mainWindow.show();
  await mainWindow.setFocus();
}
