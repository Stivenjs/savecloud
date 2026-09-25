import type { ReactNode } from "react";

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
      {/* Solo transform: el lift va por GPU */}
      <div className="relative rounded-xl shadow-md transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-1 group-active:translate-y-0 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 transform-gpu">
        {/* Sombra + anillo pre-pintados: solo cambia la opacidad, nunca se repinta */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl opacity-0 shadow-[0_16px_32px_-6px_rgb(0_0_0/0.4)] ring-1 ring-white/10 transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none transform-gpu"
        />
        {children}
      </div>
    </div>
  );
}
