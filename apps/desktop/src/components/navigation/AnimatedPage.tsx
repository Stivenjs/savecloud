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
      enter={{ "game-detail": "game-detail-ps5", default: "page-scale-lift" }}
      exit={{ "game-detail": "game-detail-ps5", default: "page-scale-lift" }}
      default="none">
      {children}
    </ViewTransition>
  );
}
