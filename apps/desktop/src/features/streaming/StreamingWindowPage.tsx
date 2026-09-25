import { useEffect, useState, useCallback } from "react";
import { VideoPlayer } from "@components/streaming/VideoPlayer";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { TitleBar } from "@components/layout/TitleBar";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Maximize2, Minimize2, RefreshCw, X } from "lucide-react";
import { Button, Chip, Tooltip } from "@heroui/react";

/**
 * Vista de ventana independiente de streaming de juego.
 *
 * @returns {JSX.Element} Vista de ventana flotante de stream
 */
export const StreamingWindowPage = () => {
  const { t } = useTranslation();
  const [wsPort, setWsPort] = useState<number | null>(null);
  const [webTransportPort, setWebTransportPort] = useState<number | undefined>(undefined);
  const [certHash, setCertHash] = useState<string | undefined>(undefined);
  const [isFullscreen, setIsFullscreen] = useState(true);
  const [showToolbar, setShowToolbar] = useState(false);
  const [isMirror, setIsMirror] = useState(false);

  const toggleFullscreen = useCallback(async () => {
    try {
      const nextState = await invoke<boolean>("streaming_toggle_fullscreen");
      setIsFullscreen(nextState);
    } catch (err) {
      console.error("Error al alternar pantalla completa:", err);
    }
  }, []);

  const releaseInputs = useCallback(async () => {
    try {
      await invoke("streaming_release_inputs");
    } catch (err) {
      console.error("Error liberando entradas:", err);
    }
  }, []);

  const closeWindow = useCallback(async () => {
    try {
      const appWindow = getCurrentWebviewWindow();
      await appWindow.close();
    } catch (err) {
      console.error("Error al cerrar ventana de stream:", err);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const portStr = params.get("wsPort");
    if (portStr) {
      setWsPort(parseInt(portStr, 10));
    }
    const wtPortStr = params.get("webTransportPort");
    if (wtPortStr) {
      setWebTransportPort(parseInt(wtPortStr, 10));
    }
    const cert = params.get("certHash");
    if (cert) {
      setCertHash(cert);
    }
    if (params.get("isMirror") === "true") {
      setIsMirror(true);
    }

    const appWindow = getCurrentWebviewWindow();
    appWindow.setTitle(t("remotePlay.windowTitle")).catch(console.error);

    const handleKeyDown = (e: KeyboardEvent) => {
      // F11: Alternar Pantalla Completa
      if (e.key === "F11") {
        e.preventDefault();
        void toggleFullscreen();
      }
      // Ctrl + Shift + Alt + R: Liberación forzada de teclas pegadas
      if (e.ctrlKey && e.shiftKey && e.altKey && (e.key === "r" || e.key === "R")) {
        e.preventDefault();
        void releaseInputs();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [t, toggleFullscreen, releaseInputs]);

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
    <div className="relative w-screen h-screen overflow-hidden bg-black select-none cursor-none">
      {/* Barra de control flotante superior discreta (Solo visible al activar hover o en modo ventana) */}
      {!isFullscreen ? (
        <div className="absolute top-0 inset-x-0 z-50 bg-black/90 border-b border-white/10 cursor-none">
          <TitleBar className="cursor-none" />
        </div>
      ) : (
        <div
          className="absolute top-0 inset-x-0 z-50 flex justify-center pt-1 pb-4 group cursor-none"
          onMouseEnter={() => {
            if (!document.pointerLockElement) {
              setShowToolbar(true);
            }
          }}
          onMouseLeave={() => setShowToolbar(false)}>
          <div
            className={`flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/80 backdrop-blur-md border border-white/15 shadow-2xl transition-all duration-300 cursor-none ${
              showToolbar ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4 pointer-events-none"
            }`}>
            {isMirror ? (
              <Chip
                size="sm"
                color="secondary"
                variant="flat"
                className="font-semibold text-xs border border-secondary-500/30 cursor-none">
                {t("remotePlay.lanHosts.mirrorHost")}
              </Chip>
            ) : null}

            <Tooltip content="Alternar Pantalla Completa (F11)">
              <Button
                size="sm"
                isIconOnly
                variant="flat"
                color="primary"
                onPress={toggleFullscreen}
                className="cursor-none">
                {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </Button>
            </Tooltip>

            <Tooltip content="Liberar Teclas Pegadas (Ctrl+Shift+Alt+R)">
              <Button
                size="sm"
                isIconOnly
                variant="flat"
                color="warning"
                onPress={releaseInputs}
                className="cursor-none">
                <RefreshCw size={15} />
              </Button>
            </Tooltip>

            <div className="w-px h-4 bg-white/20 my-auto" />

            <Tooltip content="Salir de Streaming">
              <Button size="sm" isIconOnly variant="flat" color="danger" onPress={closeWindow} className="cursor-none">
                <X size={15} />
              </Button>
            </Tooltip>
          </div>
        </div>
      )}

      {/* Reproductor de video ocupando el 100% de la ventana sin paddings ni bordes */}
      <div className={`absolute inset-0 z-10 w-full h-full cursor-none ${!isFullscreen ? "pt-8" : ""}`}>
        <VideoPlayer wsPort={wsPort} webTransportPort={webTransportPort} certHash={certHash} />
      </div>
    </div>
  );
};
