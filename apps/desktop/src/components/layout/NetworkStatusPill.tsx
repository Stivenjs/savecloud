import { useEffect, useState } from "react";
import { getLocalObservabilitySnapshot } from "@services/tauri/observability.service";
import type { WsHealthBlock } from "@app-types/observability";
import { Tooltip } from "@heroui/react";
import { openOrFocusSettingsWindow } from "@/windows/settingsWindow";
import { visibilityManager } from "@hooks/useAppVisibility";

export function NetworkStatusPill() {
  const [wsState, setWsState] = useState<WsHealthBlock | null>(null);

  useEffect(() => {
    let isMounted = true;
    let interval: ReturnType<typeof setInterval> | null = null;

    const checkWsState = async () => {
      try {
        const snapshot = await getLocalObservabilitySnapshot();
        if (isMounted && snapshot?.ws) {
          setWsState(snapshot.ws);
        }
      } catch (err) {
        // Silencioso si no está listo el backend
      }
    };

    const startTimer = () => {
      void checkWsState();
      if (interval === null) {
        interval = setInterval(checkWsState, 5000);
      }
    };

    const stopTimer = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };

    if (visibilityManager.isVisible) {
      startTimer();
    }

    const unsub = visibilityManager.subscribe(
      () => stopTimer(),
      () => startTimer()
    );

    return () => {
      isMounted = false;
      unsub();
      stopTimer();
    };
  }, []);

  const isConnected = wsState?.connected ?? false;

  return (
    <Tooltip
      content={
        <div className="p-2 space-y-1 text-xs">
          <div className="font-bold flex items-center gap-1.5 text-zinc-100">
            <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-400" : "bg-amber-400"}`} />
            {isConnected ? "WebSocket Cloud Conectado" : "Reconectando WebSocket..."}
          </div>
          {wsState?.totalSuccessfulConnections ? (
            <p className="text-zinc-400 text-[11px]">Conexiones acumuladas: {wsState.totalSuccessfulConnections}</p>
          ) : null}
          <p
            className="text-[10px] text-emerald-400 hover:underline cursor-pointer pt-1 font-medium"
            onClick={() => openOrFocusSettingsWindow()}>
            Abrir panel de observabilidad →
          </p>
        </div>
      }
      placement="bottom"
      closeDelay={100}>
      <button
        onClick={() => openOrFocusSettingsWindow()}
        className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-900/80 hover:bg-zinc-800/90 border border-zinc-800/80 transition-colors cursor-pointer text-xs select-none">
        <span className="relative flex h-2 w-2">
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${isConnected ? "bg-emerald-500" : "bg-amber-500"}`}
          />
        </span>
        <span className="text-[10px] font-semibold text-zinc-300 tracking-wide">
          {isConnected ? "WS LIVE" : "RECONECTANDO"}
        </span>
      </button>
    </Tooltip>
  );
}
