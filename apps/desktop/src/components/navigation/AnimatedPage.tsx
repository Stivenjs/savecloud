import { type ReactNode, useState, ViewTransition } from "react";
import { useLocation } from "react-router-dom";
import { useLowPerformanceMode } from "@hooks/useLowPerformanceMode";
import { DeferredContent } from "@components/ui/DeferredContent";

interface AnimatedPageProps {
  children: ReactNode;
}

export function AnimatedPage({ children }: AnimatedPageProps) {
  const isLowPerf = useLowPerformanceMode();
  const { pathname } = useLocation();
  const [enteredWhileScrolled] = useState(() => (window.scrollY || document.documentElement.scrollTop || 0) > 0);

  if (isLowPerf || (pathname.startsWith("/games/") && enteredWhileScrolled)) {
    return <>{children}</>;
  }

  return (
    <ViewTransition
      enter={{ "game-detail": "game-detail-ps5", default: "page-scale-lift" }}
      exit={{ "game-detail": "game-detail-ps5", default: "page-scale-lift" }}
      default="none">
      <DeferredContent fallback={<div className="min-h-[50vh] opacity-0" aria-hidden="true" />}>
        {children}
      </DeferredContent>
    </ViewTransition>
  );
}
