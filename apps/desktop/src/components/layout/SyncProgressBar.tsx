import { AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSyncStore } from "@store/SyncStore";
import { useTorrentStore } from "@store/TorrentStore";
import { requestUploadCancel, requestUploadPause, syncUploadResume } from "@services/tauri";
import { SyncFloatingBar } from "@/components/layout/SyncFloatingBar";
import { PausedUploadBar } from "@/components/layout/PausedUploadBar";
import { TorrentProgressBar } from "@/components/layout/TorrentProgressBar";

export type { SyncProgressState } from "@store/SyncStore";

export function SyncProgressBar() {
  const syncOperation = useSyncStore((s) => s.syncOperation);
  const progress = useSyncStore((s) => s.progress);
  const pausedUploadInfo = useSyncStore((s) => s.pausedUploadInfo);
  const clearPausedUploadInfo = useSyncStore((s) => s.clearPausedUploadInfo);
  const torrentProgress = useTorrentStore((s) => s.progress);

  const [resuming, setResuming] = useState(false);
  const [speedBps, setSpeedBps] = useState<number | null>(null);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);

  const startRef = useRef<number | null>(null);
  const constraintsRef = useRef<HTMLDivElement | null>(null);
  const lastProgressRef = useRef<{ loaded: number; t: number; gameId: string; filename: string } | null>(null);

  const onCancelUpload = useCallback(() => {
    requestUploadCancel().catch(() => {});
  }, []);

  const onPauseUpload = useCallback(() => {
    requestUploadPause().catch(() => {});
  }, []);

  const onResumeUpload = useCallback(async () => {
    setResuming(true);
    try {
      await syncUploadResume();
      clearPausedUploadInfo();
    } finally {
      setResuming(false);
    }
  }, [clearPausedUploadInfo]);

  const isClipOperation = Boolean(progress?.filename?.startsWith("Clip:"));
  const isPackagedOperation =
    progress?.filename?.includes("Empaquetando") ||
    progress?.filename?.includes("Extrayendo") ||
    progress?.filename?.startsWith("backups/") ||
    progress?.filename?.endsWith(".tar") ||
    isClipOperation;

  const showFloatingBar = Boolean(
    progress && (syncOperation?.mode === "batch" || isPackagedOperation || isClipOperation)
  );

  const isIndeterminate =
    progress &&
    (progress.filename?.includes("Empaquetando") || progress.filename?.includes("Extrayendo") || progress.total <= 0);

  const value =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;

  const canPause = !!progress?.canPause;
  const canCancel = !!progress?.canCancel;

  useEffect(() => {
    if (!progress) {
      setSpeedBps(null);
      setEtaSeconds(null);
      startRef.current = null;
      lastProgressRef.current = null;
      return;
    }

    const now = performance.now();
    const last = lastProgressRef.current;

    if (
      !last ||
      last.gameId !== progress.gameId ||
      last.filename !== progress.filename ||
      progress.loaded < last.loaded
    ) {
      startRef.current = now;
      lastProgressRef.current = {
        loaded: progress.loaded,
        t: now,
        gameId: progress.gameId,
        filename: progress.filename,
      };
      setSpeedBps(null);
      setEtaSeconds(null);
      return;
    }

    if (!startRef.current) {
      startRef.current = now;
      lastProgressRef.current = {
        loaded: progress.loaded,
        t: now,
        gameId: progress.gameId,
        filename: progress.filename,
      };
      setSpeedBps(null);
      setEtaSeconds(null);
      return;
    }

    const lastPoint = lastProgressRef.current;
    if (!lastPoint || progress.loaded <= lastPoint.loaded) return;

    const dtMs = now - startRef.current;
    if (dtMs <= 0) return;

    const bps = progress.loaded / (dtMs / 1000);
    setSpeedBps(bps);

    const elapsedSec = dtMs / 1000;
    if (progress.total > 0 && bps > 0 && elapsedSec >= 2) {
      const remaining = progress.total - progress.loaded;
      setEtaSeconds(Math.min(remaining / bps, 2 * 60 * 60));
    } else {
      setEtaSeconds(null);
    }

    lastProgressRef.current = { loaded: progress.loaded, t: now, gameId: progress.gameId, filename: progress.filename };
  }, [progress?.loaded, progress?.total, progress?.gameId, progress?.type, progress?.filename]);

  if (!showFloatingBar && !pausedUploadInfo && !torrentProgress) {
    return <AnimatePresence />;
  }

  return (
    <>
      <div ref={constraintsRef} className="pointer-events-none fixed inset-0 z-50" />

      <AnimatePresence>
        {showFloatingBar && progress && (
          <SyncFloatingBar
            progress={progress}
            constraintsRef={constraintsRef}
            isIndeterminate={!!isIndeterminate}
            value={value}
            canPause={canPause}
            canCancel={canCancel}
            speedBps={speedBps}
            etaSeconds={etaSeconds}
            onCancel={onCancelUpload}
            onPause={onPauseUpload}
          />
        )}

        {!showFloatingBar && pausedUploadInfo && (
          <PausedUploadBar
            gameId={pausedUploadInfo.gameId}
            filename={pausedUploadInfo.filename}
            constraintsRef={constraintsRef}
            resuming={resuming}
            onResume={onResumeUpload}
          />
        )}

        {!showFloatingBar && !pausedUploadInfo && torrentProgress && <TorrentProgressBar progress={torrentProgress} />}
      </AnimatePresence>
    </>
  );
}
