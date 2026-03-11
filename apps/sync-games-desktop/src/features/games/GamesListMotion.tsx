/**
 * Animación de aparición de la lista de juegos (búsqueda/filtros).
 * Entrada en escalonado (stagger): cada tarjeta hace fade-in + slide up con un pequeño retraso.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { ReactNode } from "react";

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

export interface GamesListMotionContainerProps {
  children: ReactNode;
  /** Clase del contenedor (ej. grid). */
  className?: string;
  /** Clave para re-ejecutar la animación cuando cambie la lista (ej. ids de juegos filtrados). */
  listKey?: string;
}

/**
 * Contenedor que anima la aparición de los hijos en escalonado.
 * Si cambia `listKey` (p. ej. al filtrar búsqueda), la animación se vuelve a ejecutar.
 */
export function GamesListMotionContainer({
  children,
  className,
  listKey,
}: GamesListMotionContainerProps) {
  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    setShouldAnimate(false);
    const id = requestAnimationFrame(() => {
      setShouldAnimate(true);
    });
    return () => cancelAnimationFrame(id);
  }, [listKey]);

  return (
    <motion.div
      key={listKey}
      className={className}
      variants={gamesListContainerVariants}
      initial="hidden"
      animate={shouldAnimate ? "visible" : "hidden"}
    >
      {children}
    </motion.div>
  );
}

export interface GamesListMotionItemProps {
  children: ReactNode;
}

/**
 * Envuelve cada ítem de la lista para que use la variante de entrada en escalonado.
 */
export function GamesListMotionItem({ children }: GamesListMotionItemProps) {
  return <motion.div variants={gamesListItemVariants}>{children}</motion.div>;
}
