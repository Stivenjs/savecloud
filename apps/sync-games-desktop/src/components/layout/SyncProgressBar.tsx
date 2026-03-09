import { AnimatePresence, motion } from "framer-motion";
import { Spinner } from "@heroui/react";
import { useCallback, useState } from "react";
import { useSyncProgress } from "@contexts/SyncProgressContext";
import {
  requestUploadCancel,
  requestUploadPause,
  syncUploadResume,
} from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";

// Re-exportar para que los consumidores que importan desde layout sigan funcionando
export type { SyncProgressState } from "@contexts/SyncProgressContext";

/** Barra flotante de progreso: solo se muestra en operaciones "subir/descargar todos" (batch). */
export function SyncProgressBar() {
  const { syncOperation, progress, pausedUploadInfo, clearPausedUploadInfo } =
    useSyncProgress();
  const [resuming, setResuming] = useState(false);

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

  const isPackagedOperation =
    progress?.filename?.includes("Empaquetando") ||
    progress?.filename?.includes("Extrayendo") ||
    progress?.filename?.startsWith("backups/") ||
    progress?.filename?.endsWith(".tar");
  const showFloatingBar =
    progress &&
    (syncOperation?.mode === "batch" || isPackagedOperation);

  const isIndeterminate =
    progress &&
    (progress.filename?.includes("Empaquetando") ||
      progress.filename?.includes("Extrayendo") ||
      progress.total <= 0);
  const value =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : 0;
  const canPause =
    progress?.type === "upload" && !(isPackagedOperation && progress.total <= 0);

  return (
    <AnimatePresence>
      {showFloatingBar && progress && (
        <motion.div
          key="sync-progress"
          initial={{ y: 48, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 48, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-4 left-6 right-6 z-50 rounded-lg border border-default-200 bg-default-100/95 px-4 py-3 shadow-lg backdrop-blur sm:left-1/2 sm:right-auto sm:w-96 sm:-translate-x-1/2"
          aria-label={
            progress.type === "upload"
              ? "Progreso de subida"
              : "Progreso de descarga"
          }
          role="status"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">
              {progress.type === "upload" ? "Subiendo" : "Descargando"}:{" "}
              {formatGameDisplayName(progress.gameId)}
            </span>
            <span className="text-xs text-default-500 tabular-nums">
              {isIndeterminate ? "—" : progress.total > 0 ? `${value}%` : "—"}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="min-w-0 flex-1 truncate text-xs text-default-500">
              {progress.filename}
            </p>
            {progress.type === "upload" && (
              <span className="flex shrink-0 gap-2">
                {canPause ? (
                  <button
                    type="button"
                    onClick={onPauseUpload}
                    className="text-xs font-medium text-foreground hover:underline"
                  >
                    Pausar
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onCancelUpload}
                  className="text-xs font-medium text-danger hover:underline"
                >
                  Cancelar
                </button>
              </span>
            )}
          </div>
          {isIndeterminate ? (
            <div className="mt-2 flex items-center gap-2">
              <Spinner
                size="sm"
                color="primary"
                aria-label="Preparando datos"
              />
              <p className="text-xs text-default-500">
                Preparando datos… esto puede tardar unos minutos en juegos
                grandes.
              </p>
            </div>
          ) : (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-default-200">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={false}
                animate={{
                  width: `${value}%`,
                }}
                transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
              />
            </div>
          )}
        </motion.div>
      )}

      {/* Banner de subida pausada: Reanudar */}
      {pausedUploadInfo && (
        <motion.div
          key="paused-upload"
          initial={{ y: 48, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 48, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed bottom-4 left-6 right-6 z-50 rounded-lg border border-default-200 bg-default-100/95 px-4 py-3 shadow-lg backdrop-blur sm:left-1/2 sm:right-auto sm:w-96 sm:-translate-x-1/2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm text-foreground">
              Subida pausada: {formatGameDisplayName(pausedUploadInfo.gameId)} —{" "}
              <span className="truncate">{pausedUploadInfo.filename}</span>
            </span>
            <button
              type="button"
              onClick={onResumeUpload}
              disabled={resuming}
              className="shrink-0 text-sm font-medium text-primary hover:underline disabled:opacity-50"
            >
              {resuming ? "Reanudando…" : "Reanudar"}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
