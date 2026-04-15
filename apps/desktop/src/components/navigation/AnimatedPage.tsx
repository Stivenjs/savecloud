import { type ReactNode, ViewTransition } from "react";

interface AnimatedPageProps {
  children: ReactNode;
}

export function AnimatedPage({ children }: AnimatedPageProps) {
  return (
    <ViewTransition
      enter={{ "game-detail": "none", default: "page-slide" }}
      exit={{ "game-detail": "none", default: "page-slide" }}
      default="none">
      {children}
    </ViewTransition>
  );
}
