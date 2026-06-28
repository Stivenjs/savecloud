import { motion } from "framer-motion";
import type { ReactNode } from "react";

const SHADOW_REST = "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)";
const SHADOW_HOVER = "0 20px 40px -8px rgb(0 0 0 / 0.4), 0 0 0 1px rgb(0 0 0 / 0.04)";

export interface GameCardHoverMotionProps {
  children: ReactNode;
  className?: string;
  disableMotion?: boolean;
}

export function GameCardHoverMotion({
  children,
  className = "rounded-2xl",
  disableMotion = false,
}: GameCardHoverMotionProps) {
  if (disableMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={`${className} group`}>
      <motion.div
        className="relative group/motion"
        initial={false}
        whileHover={{
          y: -4,
          scale: 1.01,
          boxShadow: SHADOW_HOVER,
          transition: { type: "spring", stiffness: 120, damping: 22 },
        }}
        whileTap={{
          scale: 0.99,
          transition: { type: "spring", stiffness: 250, damping: 25 },
        }}
        style={{
          boxShadow: SHADOW_REST,
        }}>
        {children}
      </motion.div>
    </div>
  );
}
