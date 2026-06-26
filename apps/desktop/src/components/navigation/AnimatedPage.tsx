import { type ReactNode, ViewTransition } from "react";
import { useLowPerformanceMode } from "@hooks/useLowPerformanceMode";

interface AnimatedPageProps {
  children: ReactNode;
}

export function AnimatedPage({ children }: AnimatedPageProps) {
  const isLowPerf = useLowPerformanceMode();

  if (isLowPerf) {
    return <>{children}</>;
  }

  return (
    <ViewTransition
      enter={{ "game-detail": "none", default: "page-slide" }}
      exit={{ "game-detail": "none", default: "page-slide" }}
      default="none">
      {children}
    </ViewTransition>
  );
}
