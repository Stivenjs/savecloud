import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import {
  SETTINGS_SIDEBAR_PANEL_TRANSITION,
  settingsSidebarPanelVariants,
} from "@/constants/settingsSidebarMotion.constants";
import { DeferredContent } from "@components/ui/DeferredContent";

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
  className = "",
}: SettingsSidebarAnimatedPanelProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <div className={`relative min-h-0 w-full ${className}`}>
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
          className="w-full will-change-transform"
          style={prefersReducedMotion ? undefined : { willChange: "opacity, transform" }}>
          <DeferredContent fallback={<div className="min-h-32 opacity-0" aria-hidden="true" />}>
            {children}
          </DeferredContent>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
