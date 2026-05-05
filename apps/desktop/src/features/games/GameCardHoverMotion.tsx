import { useRef } from "react";
import { motion, useMotionValue, useSpring } from "framer-motion";
import type { ReactNode } from "react";

const PERSPECTIVE = 1200;
const TILT_MAX = 12;
const SPRING_CONFIG = { stiffness: 300, damping: 30 };

const SHADOW_REST = "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)";
const SHADOW_HOVER = "0 28px 56px -12px rgb(0 0 0 / 0.35), 0 0 0 1px rgb(0 0 0 / 0.06)";

export interface GameCardHoverMotionProps {
  children: ReactNode;
  className?: string;
  /** Sin tilt ni sombra al pasar el ratón (p. ej. catálogo Steam). */
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

  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const glareX = useMotionValue(0);
  const glareY = useMotionValue(0);
  const parallaxX = useMotionValue(0);
  const parallaxY = useMotionValue(0);

  const rectRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const springRotateX = useSpring(rotateX, SPRING_CONFIG);
  const springRotateY = useSpring(rotateY, SPRING_CONFIG);
  const springGlareX = useSpring(glareX, SPRING_CONFIG);
  const springGlareY = useSpring(glareY, SPRING_CONFIG);
  const springParallaxX = useSpring(parallaxX, SPRING_CONFIG);
  const springParallaxY = useSpring(parallaxY, SPRING_CONFIG);

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    rectRef.current = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  };

  const isUpdatingRef = useRef(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isUpdatingRef.current) return;

    isUpdatingRef.current = true;

    requestAnimationFrame(() => {
      const rect = rectRef.current;
      if (!rect) {
        isUpdatingRef.current = false;
        return;
      }

      const { left, top, width, height } = rect;
      const x = e.clientX - left - width / 2;
      const y = e.clientY - top - height / 2;

      rotateY.set((x / width) * TILT_MAX);
      rotateX.set((y / height) * -TILT_MAX);

      glareX.set(x);
      glareY.set(y);

      parallaxX.set((x / width) * -6);
      parallaxY.set((y / height) * -6);

      isUpdatingRef.current = false;
    });
  };

  const handleMouseLeave = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rectRef.current = null;
    rotateX.set(0);
    rotateY.set(0);
    glareX.set(0);
    glareY.set(0);
    parallaxX.set(0);
    parallaxY.set(0);
  };

  return (
    <div
      className={`${className} group`}
      style={{
        perspective: PERSPECTIVE,
        transformStyle: "preserve-3d",
      }}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}>
      <motion.div
        style={{
          rotateX: springRotateX,
          rotateY: springRotateY,
          transformStyle: "preserve-3d",
          boxShadow: SHADOW_REST,
        }}
        className="relative group/motion transform-gpu backface-hidden"
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
        }}>
        {/* Capa de Brillo (Glare / Glint) */}
        <motion.div
          style={{
            background: "radial-gradient(circle at center, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0) 80%)",
            x: springGlareX,
            y: springGlareY,
            translateX: "-50%",
            translateY: "-50%",
            opacity: 0,
          }}
          whileHover={{ opacity: 1 }}
          className="pointer-events-none absolute left-[50%] top-[50%] z-50 size-[140%] rounded-full mix-blend-soft-light transition-opacity duration-500"
        />

        {/* Contenedor Parallax para el contenido */}
        <motion.div
          style={{
            x: springParallaxX,
            y: springParallaxY,
            transformStyle: "preserve-3d",
          }}
          className="size-full">
          {children}
        </motion.div>
      </motion.div>
    </div>
  );
}
