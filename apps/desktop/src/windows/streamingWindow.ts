import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { resolveExistingWebviewWindow, showCenteredAndFocus } from "@/windows/webviewRecovery";

export const STREAMING_WINDOW_LABEL = "streaming-window";

export async function openOrFocusStreamingWindow(wsPort: number, isMirror?: boolean): Promise<void> {
  const existing = await resolveExistingWebviewWindow(STREAMING_WINDOW_LABEL);
  if (existing) {
    try {
      await existing.destroy();
    } catch {
      // ignore
    }
  }

  const windowUrl = `/?streamingWindow=true&wsPort=${wsPort}${isMirror ? "&isMirror=true" : ""}`;

  const streamingWindow = new WebviewWindow(STREAMING_WINDOW_LABEL, {
    title: "SaveCloud Stream",
    width: 1280,
    height: 720,
    minWidth: 640,
    minHeight: 360,
    url: windowUrl,
    resizable: true,
    decorations: false,
    transparent: false,
    maximized: true,
    visible: false,
    center: true,
    fullscreen: true,
  });

  streamingWindow.once("tauri://created", async () => {
    await streamingWindow.setFullscreen(true);
    await streamingWindow.show();
    await streamingWindow.setFocus();
  });

  streamingWindow.once("tauri://error", async (event) => {
    console.error("[StreamingWindow] Error creando ventana separada:", event);
    const recovered = await resolveExistingWebviewWindow(STREAMING_WINDOW_LABEL);
    if (recovered) {
      await showCenteredAndFocus(recovered);
    }
  });
}
