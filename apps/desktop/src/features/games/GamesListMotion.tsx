import { useEffect, useState, type ReactNode } from "react";

export interface GamesListMotionContainerProps {
  children: ReactNode;
  className?: string;
  listKey?: string;
}

/**
 * Contenedor de la lista de juegos con micro-fade de entrada acelerado 100% por CSS nativo en GPU.
 */
export function GamesListMotionContainer({ children, className, listKey }: GamesListMotionContainerProps) {
  const [animating, setAnimating] = useState(true);

  useEffect(() => {
    setAnimating(false);
    const raf = requestAnimationFrame(() => {
      setAnimating(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [listKey]);

  return <div className={`${className ?? ""} ${animating ? "animate-games-list-enter" : "opacity-0"}`}>{children}</div>;
}

export interface GamesListMotionItemProps {
  children: ReactNode;
}

export function GamesListMotionItem({ children }: GamesListMotionItemProps) {
  return <div className="[content-visibility:auto] [contain-intrinsic-size:auto_280px]">{children}</div>;
}
