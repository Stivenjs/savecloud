import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export const FRIENDS_WINDOW_LABEL = "friends-window";

export async function openOrFocusFriendsWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(FRIENDS_WINDOW_LABEL);
  if (existing) {
    await existing.center();
    await existing.show();
    await existing.setFocus();
    return;
  }

  const windowUrl = "/?friendsWindow=true";

  const friendsWindow = new WebviewWindow(FRIENDS_WINDOW_LABEL, {
    title: "Miembros cloud",
    width: 460,
    height: 760,
    minWidth: 380,
    minHeight: 560,
    url: windowUrl,
    resizable: true,
    decorations: false,
    transparent: true,
    visible: false,
    center: true,
  });

  friendsWindow.once("tauri://created", async () => {
    await friendsWindow.show();
    await friendsWindow.setFocus();
  });

  friendsWindow.once("tauri://error", (event) => {
    console.error("[FriendsWindow] Error creando ventana separada:", event);
  });
}

export async function focusMainWindow(): Promise<void> {
  const mainWindow = await WebviewWindow.getByLabel("main");
  if (!mainWindow) return;
  await mainWindow.show();
  await mainWindow.setFocus();
}
