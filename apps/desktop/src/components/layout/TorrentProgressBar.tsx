import { motion } from "framer-motion";
import { Tooltip } from "@heroui/react";
import { useCallback, useRef, useState } from "react";
import type { TorrentProgressState } from "@store/TorrentStore";
import { useTorrentStore } from "@store/TorrentStore";
import { cancelTorrent, pauseTorrent, resumeTorrent } from "@services/tauri";
import { formatBytes } from "@utils/format";
import { formatEta, formatSpeed } from "@utils/progress";
import { Clock, Download, Pause, Play, Upload, Users, X, Zap } from "lucide-react";

interface TorrentProgressBarProps {
  progress: TorrentProgressState;
}

export function TorrentProgressBar({ progress }: TorrentProgressBarProps) {
  const constraintsRef = useRef<HTMLDivElement | null>(null);
  const value = Math.min(100, Math.round(progress.progressPercent));
  const isCompleted = progress.state === "completed";
  const isPaused = progress.state === "paused";
  const hasInfoHash = progress.infoHash.length > 0;
  const [toggling, setToggling] = useState(false);

  const onCancel = useCallback(() => {
    cancelTorrent(progress.infoHash)
      .then(() => useTorrentStore.getState().setProgress(null))
      .catch(() => {});
  }, [progress.infoHash]);

  const onTogglePause = useCallback(async () => {
    setToggling(true);
    try {
      if (isPaused) {
        await resumeTorrent(progress.infoHash);
      } else {
        await pauseTorrent(progress.infoHash);
      }
    } catch {
      // silenciar
    } finally {
      setToggling(false);
    }
  }, [progress.infoHash, isPaused]);

  return (
    <>
      <div ref={constraintsRef} className="pointer-events-none fixed inset-0 z-50" />
      <motion.div
        key="torrent-progress"
        drag
        dragConstraints={constraintsRef}
        dragElastic={0.1}
        dragMomentum={false}
        initial={{ y: 48, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 48, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed bottom-4 left-6 right-6 z-50 cursor-grab rounded-xl border border-default-200 bg-default-50/95 px-4 py-3.5 shadow-lg backdrop-blur active:cursor-grabbing sm:left-1/2 sm:right-auto sm:w-104 sm:-translate-x-1/2"
        aria-label="Progreso de descarga torrent"
        role="status"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                isPaused ? "bg-warning/10 text-warning" : "bg-secondary/10 text-secondary"
              }`}>
              <Download size={10} aria-hidden />
              {isPaused ? "Pausado" : "Torrent"}
            </span>
            <span className="truncate text-sm font-medium text-foreground">{progress.name}</span>
          </div>
          <span className="shrink-0 text-xs font-semibold text-default-500 tabular-nums">
            {isCompleted ? "100%" : `${value}%`}
          </span>
        </div>

        <div className="mt-1 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-default-400">
            {progress.state === "starting" &&
              (progress.totalBytes > 0 && progress.progressPercent > 0
                ? "Verificando datos ya en disco (reanudación)…"
                : "Iniciando…")}
            {progress.state === "downloading" &&
              (progress.downloadedBytes > 0
                ? "Descargando…"
                : progress.peersConnected > 0
                  ? "Conectado, esperando datos…"
                  : "Buscando peers…")}
            {progress.state === "paused" && "Descarga en pausa"}
            {progress.state === "completed" && "¡Descarga completa!"}
          </p>
          {!isCompleted && (
            <>
              <span className="shrink-0 text-default-200 select-none" aria-hidden>
                |
              </span>
              <span className="flex shrink-0 gap-1 pointer-events-auto">
                <Tooltip content={isPaused ? "Reanudar" : "Pausar"} placement="top">
                  <button
                    type="button"
                    onClick={onTogglePause}
                    disabled={toggling || !hasInfoHash}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-foreground hover:bg-default-200 transition-colors disabled:opacity-50"
                    aria-label={isPaused ? "Reanudar torrent" : "Pausar torrent"}
                    onPointerDownCapture={(e) => e.stopPropagation()}>
                    {isPaused ? <Play size={14} /> : <Pause size={14} />}
                  </button>
                </Tooltip>
                <Tooltip content="Cancelar torrent" placement="top">
                  <button
                    type="button"
                    onClick={onCancel}
                    disabled={!hasInfoHash}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                    aria-label="Cancelar torrent"
                    onPointerDownCapture={(e) => e.stopPropagation()}>
                    <X size={14} />
                  </button>
                </Tooltip>
              </span>
            </>
          )}
        </div>

        <div className="relative mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-default-200">
          <motion.div
            className={`relative z-0 h-full origin-left rounded-full ${isCompleted ? "bg-success" : isPaused ? "bg-warning" : "bg-secondary"}`}
            initial={{ width: "0%" }}
            animate={{ width: `${value}%` }}
            transition={{
              type: "tween",
              duration: value === 0 ? 0 : 0.38,
              ease: [0.22, 1, 0.36, 1],
            }}
          />
          {value === 0 && !isCompleted && !isPaused && (
            <motion.div
              className="pointer-events-none absolute inset-y-0 z-10 w-1/4 rounded-full bg-secondary/55"
              animate={{ left: ["-30%", "100%"] }}
              transition={{ duration: 1.35, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </div>

        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-default-400">
          <span className="inline-flex items-center gap-1.5">
            <Download size={11} className="shrink-0 text-secondary" aria-hidden />
            <span>
              <span className="tabular-nums font-medium text-default-500">
                {formatBytes(progress.downloadedBytes)}
                {progress.totalBytes > 0 ? ` / ${formatBytes(progress.totalBytes)}` : ""}
              </span>
              {progress.state === "starting" && progress.totalBytes > 0 && progress.progressPercent > 0 ? (
                <span
                  className="ml-1 text-[10px] opacity-80"
                  title="Incluye archivos que ya estaban en la carpeta de destino">
                  (en disco)
                </span>
              ) : null}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Zap size={11} className="shrink-0 text-default-400" aria-hidden />
            <span className="tabular-nums font-medium text-default-500">
              {formatSpeed(progress.downloadSpeedBytes)}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Upload size={11} className="shrink-0 text-default-400" aria-hidden />
            <span className="tabular-nums font-medium text-default-500">{formatSpeed(progress.uploadSpeedBytes)}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Users size={11} className="shrink-0 text-default-400" aria-hidden />
            <span className="tabular-nums font-medium text-default-500">{progress.peersConnected}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock size={11} className="shrink-0 text-default-400" aria-hidden />
            {progress.etaSeconds != null ? (
              <span className="tabular-nums font-medium text-default-500">{formatEta(progress.etaSeconds)}</span>
            ) : (
              <span>—</span>
            )}
          </span>
        </div>
      </motion.div>
    </>
  );
}
