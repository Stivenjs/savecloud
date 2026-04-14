import { Tooltip } from "@heroui/react";
import { motion } from "framer-motion";
import { HardDrive, Pause, Upload, X } from "lucide-react";
import { useCallback, useState } from "react";
import type { SyncProgressState } from "@components/layout";
import { requestUploadCancel, requestUploadPause } from "@services/tauri";
import { formatBytes } from "@utils/format";

export interface GameCardSyncProgressProps {
  /** Progreso de subida o descarga del juego. Círculo en esquina; detalles al pasar el cursor. */
  progress: SyncProgressState;
}

const RING_SIZE = 24;
const RING_STROKE = 2;
const R = (RING_SIZE - RING_STROKE) / 2;
const CX = RING_SIZE / 2;
const CY = RING_SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

/**
 * Círculo de progreso en esquina de la card. Al pasar el cursor se muestra el detalle (archivo, %, Pausar/Cancelar).
 */
export function GameCardSyncProgress({ progress }: GameCardSyncProgressProps) {
  const [hover, setHover] = useState(false);
  const onCancelUpload = useCallback(() => {
    requestUploadCancel().catch(() => {});
  }, []);

  const onPauseUpload = useCallback(() => {
    requestUploadPause().catch(() => {});
  }, []);

  const isPackagedOperation =
    progress.filename?.includes("Empaquetando") ||
    progress.filename?.includes("Extrayendo") ||
    progress.filename?.startsWith("backups/") ||
    progress.filename?.endsWith(".tar");

  // No mostramos nada para operaciones sin total y que no son empaquetados/backups.
  if (progress.total <= 0 && !isPackagedOperation) return null;

  const isIndeterminate =
    progress.filename?.includes("Empaquetando") || progress.filename?.includes("Extrayendo") || progress.total <= 0;

  const percent = Math.min(100, Math.round((progress.loaded / progress.total) * 100));
  const strokeDashoffset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;

  return (
    <div
      className="absolute left-2 top-2 z-10 group"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <div
        className="flex cursor-default items-center justify-center rounded-full bg-default-100/90 shadow-sm ring-1 ring-default-200/80"
        title={progress.type === "upload" ? "Subiendo…" : "Descargando…"}>
        {isIndeterminate ? (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{
              duration: 0.9,
              repeat: Infinity,
              ease: "linear",
            }}
            className="flex p-0.5">
            <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90" aria-hidden>
              <circle
                cx={CX}
                cy={CY}
                r={R}
                fill="none"
                stroke="currentColor"
                strokeWidth={RING_STROKE}
                className="text-default-200"
              />
              <circle
                cx={CX}
                cy={CY}
                r={R}
                fill="none"
                stroke="currentColor"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={`${CIRCUMFERENCE * 0.25} ${CIRCUMFERENCE * 0.75}`}
                className="text-primary"
              />
            </svg>
          </motion.div>
        ) : (
          <div className="relative flex items-center justify-center p-0.5">
            <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90" aria-hidden>
              <circle
                cx={CX}
                cy={CY}
                r={R}
                fill="none"
                stroke="currentColor"
                strokeWidth={RING_STROKE}
                className="text-default-200"
              />
              <motion.circle
                cx={CX}
                cy={CY}
                r={R}
                fill="none"
                stroke="currentColor"
                strokeWidth={RING_STROKE}
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={strokeDashoffset}
                className="text-primary"
                transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold tabular-nums text-foreground">
              {percent}%
            </span>
          </div>
        )}
      </div>

      {hover && (
        <div className="absolute left-0 top-full z-20 mt-1 w-48 rounded-lg border border-default-200 bg-default-100 px-2 py-1.5 shadow-lg">
          <p className="truncate text-[10px] font-medium text-foreground">
            {progress.type === "upload" ? "Subiendo" : "Descargando"}:{" "}
            <span className="truncate text-default-600">{progress.filename}</span>
          </p>
          <p className="mt-0.5 text-[10px] tabular-nums text-default-500">{isIndeterminate ? "—" : `${percent}%`}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[10px] tabular-nums text-default-500">
            {progress.type === "upload" ? (
              <Upload size={10} className="shrink-0 text-primary" aria-hidden />
            ) : (
              <HardDrive size={10} className="shrink-0 text-primary" aria-hidden />
            )}
            <span>
              {progress.type === "upload" ? "Enviados" : "En disco"}: {formatBytes(progress.loaded)}
              {progress.total > 0 ? ` / ${formatBytes(progress.total)}` : ""}
            </span>
          </p>
          {progress.type === "upload" && !isIndeterminate && (
            <div className="mt-1.5 flex shrink-0 gap-1">
              <Tooltip content="Pausar subida" placement="top">
                <button
                  type="button"
                  onClick={onPauseUpload}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-foreground hover:bg-default-200"
                  aria-label="Pausar subida">
                  <Pause size={12} />
                </button>
              </Tooltip>
              <Tooltip content="Cancelar subida" placement="top">
                <button
                  type="button"
                  onClick={onCancelUpload}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-danger hover:bg-danger/10"
                  aria-label="Cancelar subida">
                  <X size={12} />
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
