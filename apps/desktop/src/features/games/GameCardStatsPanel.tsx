import { Clock } from "lucide-react";
import { motion } from "framer-motion";
import type { Variants } from "framer-motion";
import type { GameStats } from "@services/tauri";
import { formatBytes, formatPlaytime, formatRelativeDate } from "@utils/format";
import { useTranslation } from "react-i18next";

export interface GameCardStatsPanelProps {
  stats: GameStats;
  editionLabel?: string;
}

const panelVariants: Variants = {
  rest: {
    y: "100%",
    transition: {
      type: "spring" as const,
      stiffness: 450,
      damping: 35,
    },
    transitionEnd: {
      display: "none",
    },
  },
  hover: {
    display: "flex",
    y: "0%",
    transition: {
      type: "spring" as const,
      stiffness: 400,
      damping: 32,
      mass: 0.7,
      staggerChildren: 0.02,
      delayChildren: 0.02,
    },
  },
};

const itemVariants: Variants = {
  rest: {
    opacity: 0,
    y: 8,
    transition: {
      type: "spring" as const,
      stiffness: 500,
      damping: 38,
    },
  },
  hover: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 350,
      damping: 22,
    },
  },
};

export function GameCardStatsPanel({ stats, editionLabel }: GameCardStatsPanelProps) {
  const { t } = useTranslation();

  return (
    <motion.div
      variants={panelVariants}
      className="absolute inset-0 bg-zinc-950/95 p-3 flex flex-col justify-center gap-1.5 z-20 rounded-xl subpixel-antialiased transform-gpu backface-hidden">
      <motion.div
        variants={itemVariants}
        className="flex items-center justify-between text-[10px] text-zinc-400 backface-hidden">
        <span className="font-semibold uppercase tracking-wider text-[8px]">{t("library.gameCardStats.saved")}</span>
        <span className="font-bold font-mono text-zinc-200">{formatBytes(stats.localSizeBytes)}</span>
      </motion.div>

      {stats.localLastModified != null && (
        <motion.div
          variants={itemVariants}
          className="flex items-center justify-between text-[10px] text-zinc-400 backface-hidden">
          <span className="font-semibold uppercase tracking-wider text-[8px]">
            {t("library.gameCardStats.lastTime")}
          </span>
          <span
            className="font-bold text-right truncate max-w-32.5 text-zinc-200"
            title={formatRelativeDate(stats.localLastModified)}>
            {formatRelativeDate(stats.localLastModified).toUpperCase()}
          </span>
        </motion.div>
      )}

      <motion.div
        variants={itemVariants}
        className="flex items-center justify-between text-[10px] text-zinc-400 backface-hidden">
        <span className="font-semibold uppercase tracking-wider text-[8px]">{t("library.gameCardStats.played")}</span>
        <div className="flex items-center gap-1 text-primary font-bold font-mono">
          <Clock size={10} className="shrink-0" />
          <span>{formatPlaytime(stats.playtimeSeconds).toUpperCase()}</span>
        </div>
      </motion.div>

      {editionLabel && (
        <motion.div
          variants={itemVariants}
          className="border-t border-white/10 pt-1.5 mt-0.5 text-center text-[8.5px] text-zinc-500 font-bold uppercase tracking-wider truncate w-full backface-hidden">
          {editionLabel}
        </motion.div>
      )}
    </motion.div>
  );
}
