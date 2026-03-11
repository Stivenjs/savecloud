import { useRef } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";
import type { ReactNode } from "react";

const PERSPECTIVE = 1200;
const TILT_MAX = 12;
const SPRING_CONFIG = { stiffness: 300, damping: 30 };

const SHADOW_REST =
  "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)";
const SHADOW_HOVER =
  "0 28px 56px -12px rgb(0 0 0 / 0.35), 0 0 0 1px rgb(0 0 0 / 0.06)";

export interface GameCardHoverMotionProps {
  children: ReactNode;
  className?: string;
}

/**
 * Card con tilt 3D que sigue el ratón y elevación + sombra al hover.
 * Usamos un rect fijo al entrar para evitar feedback: si usáramos el rect
 * actual, al moverse la card (y/scale) el rect cambia y el tilt se recalcula
 * infinitamente.
 */
export function GameCardHoverMotion({
  children,
  className = "rounded-2xl",
}: GameCardHoverMotionProps) {
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const rectRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);

  const springRotateX = useSpring(rotateX, SPRING_CONFIG);
  const springRotateY = useSpring(rotateY, SPRING_CONFIG);

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    rectRef.current = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = rectRef.current ?? e.currentTarget.getBoundingClientRect();
    if (!rectRef.current) {
      rectRef.current = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    }
    const { left, top, width, height } = rectRef.current;
    const x = e.clientX - left - width / 2;
    const y = e.clientY - top - height / 2;
    const rotateYValue = (x / width) * TILT_MAX;
    const rotateXValue = (y / height) * -TILT_MAX;
    rotateY.set(rotateYValue);
    rotateX.set(rotateXValue);
  };

  const handleMouseLeave = () => {
    rectRef.current = null;
    rotateX.set(0);
    rotateY.set(0);
  };

  return (
    <div
      className={className}
      style={{
        perspective: PERSPECTIVE,
        transformStyle: "preserve-3d",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div
        style={{
          rotateX: springRotateX,
          rotateY: springRotateY,
          transformStyle: "preserve-3d",
          boxShadow: SHADOW_REST,
        }}
        initial={false}
        whileHover={{
          y: -14,
          scale: 1.04,
          boxShadow: SHADOW_HOVER,
          transition: { type: "spring", stiffness: 350, damping: 24 },
        }}
        whileTap={{
          scale: 0.98,
          transition: { type: "spring", stiffness: 500, damping: 30 },
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
