/**
 * Variantes de framer-motion para la lista de juegos.
 * Separadas del componente para compatibilidad con Vite HMR (Fast Refresh).
 */

const STAGGER_DELAY = 0.05;
const ITEM_DURATION = 0.4;

export const gamesListContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: STAGGER_DELAY,
      delayChildren: 0.03,
    },
  },
};

export const gamesListItemVariants = {
  hidden: {
    opacity: 0,
    y: 20,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: ITEM_DURATION,
      ease: [0.25, 0.46, 0.45, 0.94] as const,
    },
  },
};
