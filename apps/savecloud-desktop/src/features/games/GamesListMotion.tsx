/**
 * Animación de aparición de la lista de juegos (búsqueda/filtros).
 * Entrada en escalonado (stagger): cada tarjeta hace fade-in + slide up con un pequeño retraso.
 *
 * IMPORTANTE: no usar key={listKey} en el contenedor — eso desmonta y remonta
 * todo el árbol destruyendo memo en los hijos. En su lugar usamos useAnimationControls
 * para re-ejecutar la animación de forma imperativa sin tocar el DOM.
 */

import { useEffect } from "react";
import { motion, useAnimationControls } from "framer-motion";
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
  className?: string;
  /**
   * Cuando cambia este valor se re-ejecuta la animación de entrada.
   * Ya no se usa como `key` del nodo — el árbol DOM se preserva para
   * que memo en los hijos funcione correctamente.
   */
  listKey?: string;
}

export function GamesListMotionContainer({ children, className, listKey }: GamesListMotionContainerProps) {
  const controls = useAnimationControls();

  useEffect(() => {
    controls.set("hidden");
    const id = requestAnimationFrame(() => {
      void controls.start("visible");
    });
    return () => cancelAnimationFrame(id);
  }, [listKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div className={className} variants={gamesListContainerVariants} initial="hidden" animate={controls}>
      {children}
    </motion.div>
  );
}

export interface GamesListMotionItemProps {
  children: ReactNode;
}

export function GamesListMotionItem({ children }: GamesListMotionItemProps) {
  return <motion.div variants={gamesListItemVariants}>{children}</motion.div>;
}
