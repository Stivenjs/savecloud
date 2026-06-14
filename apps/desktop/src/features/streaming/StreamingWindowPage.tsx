import { useEffect, useState } from "react";
import { VideoPlayer } from "@components/streaming/VideoPlayer";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

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
      <div className="flex items-center justify-center h-screen bg-black text-white">
        <h2>Iniciando conexión de streaming...</h2>
      </div>
    );
  }

  return <VideoPlayer wsPort={wsPort} />;
};
