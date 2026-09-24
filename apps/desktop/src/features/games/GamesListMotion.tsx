import { useRef, type ReactNode } from "react";

export interface GamesListMotionContainerProps {
  children: ReactNode;
  className?: string;
  listKey?: string;
}

/**
 * Contenedor de la lista de juegos con micro-fade de entrada acelerado 100% por CSS nativo en GPU.
 */
export function GamesListMotionContainer({ children, className, listKey }: GamesListMotionContainerProps) {
  const counterRef = useRef(0);
  const prevKeyRef = useRef(listKey);

  if (prevKeyRef.current !== listKey) {
    prevKeyRef.current = listKey;
    counterRef.current += 1;
  }

  return (
    <div key={counterRef.current} className={`${className ?? ""} animate-games-list-enter`}>
      {children}
    </div>
  );
}

export interface GamesListMotionItemProps {
  children: ReactNode;
}

export function GamesListMotionItem({ children }: GamesListMotionItemProps) {
  return <div className="[content-visibility:auto] [contain-intrinsic-size:auto_280px] p-2 -m-2">{children}</div>;
}
