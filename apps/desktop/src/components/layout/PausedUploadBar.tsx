import { motion } from "framer-motion";
import type { RefObject } from "react";
import { formatGameDisplayName } from "@utils/gameImage";
import { PauseCircle } from "lucide-react";

interface PausedUploadBarProps {
  gameId: string;
  filename: string;
  constraintsRef: RefObject<HTMLDivElement | null>;
  resuming: boolean;
  onResume: () => void;
}

export function PausedUploadBar({ gameId, filename, constraintsRef, resuming, onResume }: PausedUploadBarProps) {
  return (
    <motion.div
      key="paused-upload"
      drag
      dragConstraints={constraintsRef}
      dragElastic={0.1}
      dragMomentum={false}
      initial={{ y: 48, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 48, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed bottom-4 left-6 right-6 z-50 cursor-grab rounded-xl border border-warning/40 bg-warning/5 px-4 py-3.5 shadow-lg backdrop-blur active:cursor-grabbing sm:left-1/2 sm:right-auto sm:w-96 sm:-translate-x-1/2">
      <div className="flex items-center gap-3">
        <PauseCircle size={20} className="shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-warning">Subida pausada</p>
          <p className="truncate text-xs text-default-500">
            {formatGameDisplayName(gameId)} — {filename}
          </p>
        </div>
        <button
          type="button"
          onClick={onResume}
          disabled={resuming}
          onPointerDownCapture={(e) => e.stopPropagation()}
          className="shrink-0 rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold text-warning hover:bg-warning/25 disabled:opacity-50 transition-colors">
          {resuming ? "Reanudando…" : "Reanudar"}
        </button>
      </div>
    </motion.div>
  );
}
