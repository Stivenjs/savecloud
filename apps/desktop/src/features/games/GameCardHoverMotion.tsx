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
      <div className="relative group/motion rounded-xl transform-gpu will-change-transform transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-md hover:-translate-y-1 hover:scale-[1.01] hover:shadow-[0_20px_40px_-8px_rgb(0_0_0/0.45)] active:scale-[0.99]">
        {children}
      </div>
    </div>
  );
}
