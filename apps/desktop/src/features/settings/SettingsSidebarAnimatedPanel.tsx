import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import {
  SETTINGS_SIDEBAR_PANEL_TRANSITION,
  settingsSidebarPanelVariants,
} from "@/constants/settingsSidebarMotion.constants";

interface SettingsSidebarAnimatedPanelProps {
  panelKey: string;
  /** Resultado de {@link useSettingsSidebarPanelDirection} */
  direction: number;
  children: ReactNode;
  className?: string;
}

export function SettingsSidebarAnimatedPanel({
  panelKey,
  direction,
  children,
  className,
}: SettingsSidebarAnimatedPanelProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className={className ?? "relative min-h-0"}>
      <AnimatePresence initial={false} custom={direction} mode="popLayout">
        <motion.div
          key={panelKey}
          role="presentation"
          custom={direction}
          variants={settingsSidebarPanelVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={prefersReducedMotion ? { duration: 0.01 } : SETTINGS_SIDEBAR_PANEL_TRANSITION}
          className="will-change-transform"
          style={prefersReducedMotion ? undefined : { willChange: "opacity, transform", transform: "translateZ(0)" }}>
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
