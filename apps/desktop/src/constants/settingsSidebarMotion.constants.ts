import type { Transition, Variants } from "framer-motion";

/** Desplazamiento vertical en px (solo transform, sin animar top/height). */
export const SETTINGS_SIDEBAR_SLIDE_PX = 20;

/**
 * Spring acorde a MOTION_INTENSITY fluido: sin linear easing duro.
 */
export const SETTINGS_SIDEBAR_PANEL_TRANSITION: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 32,
  mass: 0.85,
};

export const settingsSidebarPanelVariants: Variants = {
  enter: (direction: number) => ({
    y: direction > 0 ? SETTINGS_SIDEBAR_SLIDE_PX : direction < 0 ? -SETTINGS_SIDEBAR_SLIDE_PX : 0,
    opacity: 0,
  }),
  center: {
    y: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    y: direction > 0 ? -SETTINGS_SIDEBAR_SLIDE_PX : direction < 0 ? SETTINGS_SIDEBAR_SLIDE_PX : 0,
    opacity: 0,
  }),
};
