/**
 * @file StreamingWindowPage.tsx
 * @description Página contenedora de la ventana flotante dedicada de Remote Play.
 * Renderiza el reproductor de video en pantalla completa (100% área) con TitleBar flotante.
 */

import { useEffect, useState } from "react";
import { VideoPlayer } from "@components/streaming/VideoPlayer";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { TitleBar } from "@components/layout/TitleBar";
import { useTranslation } from "react-i18next";

/**
 * Vista de ventana independiente de streaming de juego.
 *
 * @returns {JSX.Element} Vista de ventana flotante de stream
 */
export const StreamingWindowPage = () => {
  const { t } = useTranslation();
  const [wsPort, setWsPort] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const portStr = params.get("wsPort");
    if (portStr) {
      setWsPort(parseInt(portStr, 10));
    }

    const appWindow = getCurrentWebviewWindow();
    appWindow.setTitle(t("remotePlay.windowTitle")).catch(console.error);
  }, [t]);

  if (!wsPort) {
    return (
      <div className="relative w-screen h-screen overflow-hidden bg-black text-white flex flex-col justify-between">
        <TitleBar />
        <div className="flex flex-col items-center justify-center flex-1 gap-3">
          <div className="w-8 h-8 border-3 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <h2 className="text-sm text-default-400 font-medium">{t("remotePlay.startingStream")}</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black group">
      {/* Barra de título flotante sutil que se revela al pasar el cursor */}
      <div className="absolute top-0 inset-x-0 z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-linear-to-b from-black/80 via-black/40 to-transparent pb-4">
        <TitleBar />
      </div>

      {/* Reproductor de video ocupando el 100% de la ventana sin paddings ni bordes */}
      <div className="absolute inset-0 z-10 w-full h-full">
        <VideoPlayer wsPort={wsPort} />
      </div>
    </div>
  );
};
