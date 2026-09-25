/**
 * Variantes de animación para la lista de juegos (Micro-Fade Global Unificado).
 */

export const gamesListContainerVariants = {
  hidden: {
    opacity: 0,
    scale: 0.995,
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.14,
      ease: [0.16, 1, 0.3, 1] as const,
    },
  },
};
