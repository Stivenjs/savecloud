import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { resolveExistingWebviewWindow, showCenteredAndFocus } from "@/windows/webviewRecovery";

export const STREAMING_WINDOW_LABEL = "streaming-window";

export interface StreamingConnectInfo {
  ws_port: number;
  webtransport_port?: number;
  cert_hash?: string;
}

export async function openOrFocusStreamingWindow(
  info: StreamingConnectInfo | number,
  isMirror?: boolean
): Promise<void> {
  const existing = await resolveExistingWebviewWindow(STREAMING_WINDOW_LABEL);
  if (existing) {
    try {
      await existing.destroy();
    } catch {
      // ignore
    }
  }

  const wsPort = typeof info === "number" ? info : info.ws_port;
  const webTransportPort = typeof info === "number" ? undefined : info.webtransport_port;
  const certHash = typeof info === "number" ? undefined : info.cert_hash;

  const windowUrl = `/?streamingWindow=true&wsPort=${wsPort}${webTransportPort ? `&webTransportPort=${webTransportPort}` : ""}${certHash ? `&certHash=${certHash}` : ""}${isMirror ? "&isMirror=true" : ""}`;

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
