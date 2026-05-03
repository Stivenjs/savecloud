import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { focusMainWindow } from "@/windows/mainWindow";
import { resolveExistingWebviewWindow } from "@/windows/webviewRecovery";

export const BIG_PICTURE_WINDOW_LABEL = "big-picture-window";

async function hideMainWindow(): Promise<void> {
  const mainWindow = await WebviewWindow.getByLabel("main");
  if (!mainWindow) return;
  await mainWindow.hide();
}

async function hideWindowIfExists(label: string): Promise<void> {
  const windowRef = await WebviewWindow.getByLabel(label);
  if (!windowRef) return;
  try {
    await windowRef.hide();
  } catch {
    /* ignore */
  }
}

export async function isBigPictureWindowOpen(): Promise<boolean> {
  const bigPictureWindow = await resolveExistingWebviewWindow(BIG_PICTURE_WINDOW_LABEL);
  return !!bigPictureWindow;
}

export async function openOrFocusBigPictureWindow(): Promise<void> {
  await hideWindowIfExists("settings-window");

  const existing = await resolveExistingWebviewWindow(BIG_PICTURE_WINDOW_LABEL);
  if (existing) {
    await hideMainWindow();
    await existing.show();
    await existing.setFocus();
    return;
  }

  const bigPictureWindow = new WebviewWindow(BIG_PICTURE_WINDOW_LABEL, {
    title: "SaveCloud Big Picture",
    url: "/?bigPictureWindow=true",
    fullscreen: true,
    decorations: false,
    resizable: true,
    visible: false,
    center: true,
  });

  bigPictureWindow.once("tauri://created", async () => {
    await hideMainWindow();
    await bigPictureWindow.show();
    await bigPictureWindow.setFocus();
  });

  bigPictureWindow.once("tauri://error", async (event) => {
    console.error("[BigPictureWindow] Error creando ventana:", event);
    const recovered = await resolveExistingWebviewWindow(BIG_PICTURE_WINDOW_LABEL);
    if (recovered) {
      await hideMainWindow();
      await recovered.show();
      await recovered.setFocus();
    }
  });

  await bigPictureWindow.onCloseRequested(async () => {
    await focusMainWindow();
  });
}

export async function switchToNormalMode(): Promise<void> {
  const bigPictureWindow = await resolveExistingWebviewWindow(BIG_PICTURE_WINDOW_LABEL);
  if (!bigPictureWindow) {
    await focusMainWindow();
    return;
  }

  await focusMainWindow();
  try {
    await bigPictureWindow.setFullscreen(false);
  } catch {
    /* ignore */
  }

  try {
    await bigPictureWindow.destroy();
  } catch {
    await bigPictureWindow.close();
  }
}
