import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { resolveExistingWebviewWindow, showCenteredAndFocus } from "@/windows/webviewRecovery";

export const FRIENDS_WINDOW_LABEL = "friends-window";

export async function openOrFocusFriendsWindow(): Promise<void> {
  const existing = await resolveExistingWebviewWindow(FRIENDS_WINDOW_LABEL);
  if (existing) {
    await showCenteredAndFocus(existing);
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

  friendsWindow.once("tauri://error", async (event) => {
    console.error("[FriendsWindow] Error creando ventana separada:", event);
    const recovered = await resolveExistingWebviewWindow(FRIENDS_WINDOW_LABEL);
    if (recovered) {
      await showCenteredAndFocus(recovered);
    }
  });
}
