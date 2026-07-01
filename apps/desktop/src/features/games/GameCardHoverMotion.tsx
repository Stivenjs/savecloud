import { motion } from "framer-motion";
import type { Variants } from "framer-motion";
import type { ReactNode } from "react";

const SHADOW_REST = "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)";
const SHADOW_HOVER = "0 20px 40px -8px rgb(0 0 0 / 0.4), 0 0 0 1px rgb(0 0 0 / 0.04)";

const cardVariants: Variants = {
  rest: {
    y: 0,
    scale: 1,
  },
  hover: {
    y: -4,
    scale: 1.01,
    transition: { type: "spring" as const, stiffness: 220, damping: 20 },
  },
  tap: {
    scale: 0.99,
    transition: { type: "spring" as const, stiffness: 350, damping: 25 },
  },
};

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
        className="relative group/motion rounded-xl"
        initial="rest"
        whileHover="hover"
        whileTap="tap"
        variants={cardVariants}
        style={{
          boxShadow: SHADOW_REST,
        }}>
        {/* GPU-Accelerated Shadow Overlay */}
        <motion.div
          className="absolute inset-0 rounded-xl pointer-events-none z-[-1]"
          style={{
            boxShadow: SHADOW_HOVER,
          }}
          variants={{
            rest: { opacity: 0 },
            hover: { opacity: 1, transition: { type: "spring" as const, stiffness: 220, damping: 20 } },
          }}
        />
        {children}
      </motion.div>
    </div>
  );
}
