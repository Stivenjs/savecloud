import React, { useState } from "react";
import { motion } from "framer-motion";

interface WindowEntranceAnimationProps {
  children: React.ReactNode;
  lowPerf?: boolean;
}

/**
 * Componente que envuelve el contenido de las ventanas secundarias o la ventana principal
 * y aplica una animación de entrada física y fluida al renderizarse por primera vez.
 * Una vez finalizada la animación, se desmonta el contenedor de Framer Motion
 * para restaurar por completo la funcionalidad de los elementos sticky y fixed en el DOM.
 */
export function WindowEntranceAnimation({ children, lowPerf = false }: WindowEntranceAnimationProps) {
  const [animationDone, setAnimationDone] = useState(false);

  if (lowPerf || animationDone) {
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
      onAnimationComplete={() => setAnimationDone(true)}
      style={{ overflow: "hidden" }}
      className="min-h-dvh w-full">
      {children}
    </motion.div>
  );
}
