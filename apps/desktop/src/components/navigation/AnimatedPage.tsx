import { type ReactNode, ViewTransition } from "react";
import { useLocation } from "react-router-dom";
import { useLowPerformanceMode } from "@hooks/useLowPerformanceMode";

interface AnimatedPageProps {
  children: ReactNode;
}

export function AnimatedPage({ children }: AnimatedPageProps) {
  const isLowPerf = useLowPerformanceMode();
  const location = useLocation();

  const isCatalog = location.pathname.startsWith("/catalog");

  if (isLowPerf || isCatalog) {
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
