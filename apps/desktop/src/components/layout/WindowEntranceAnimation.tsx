import React from "react";
import { motion } from "framer-motion";

interface WindowEntranceAnimationProps {
  children: React.ReactNode;
  lowPerf?: boolean;
}

/**
 * Componente que envuelve el contenido de las ventanas secundarias o la ventana principal
 * y aplica una animación de entrada física y fluida al renderizarse por primera vez.
 */
export function WindowEntranceAnimation({ children, lowPerf = false }: WindowEntranceAnimationProps) {
  if (lowPerf) {
    return <>{children}</>;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.99, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      transition={{
        duration: 0.45,
        ease: [0.16, 1, 0.3, 1],
      }}
      className="min-h-dvh w-full">
      {children}
    </motion.div>
  );
}
