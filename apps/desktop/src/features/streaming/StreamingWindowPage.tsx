import { useEffect, useState } from "react";
import { VideoPlayer } from "@components/streaming/VideoPlayer";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { TitleBar } from "@components/layout/TitleBar";

export const StreamingWindowPage = () => {
  const [wsPort, setWsPort] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const portStr = params.get("wsPort");
    if (portStr) {
      setWsPort(parseInt(portStr, 10));
    }

    const appWindow = getCurrentWebviewWindow();
    appWindow.setTitle("SaveCloud GameStream").catch(console.error);
  }, []);

  if (!wsPort) {
    return (
      <div className="relative w-screen h-screen overflow-hidden bg-black text-white">
        <TitleBar />
        <div className="flex items-center justify-center h-full">
          <h2>Iniciando conexión de streaming...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      <TitleBar />
      <div className="absolute inset-x-0 bottom-0 top-10 z-40">
        <VideoPlayer wsPort={wsPort} />
      </div>
    </div>
  );
};
