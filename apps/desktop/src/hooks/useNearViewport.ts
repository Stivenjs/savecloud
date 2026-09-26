import { useEffect, useRef, useState } from "react";

const IMAGE_PRELOAD_ROOT_MARGIN = "320px";

/** Starts loading viewport content shortly before it becomes visible. */
export function useNearViewport<T extends HTMLElement>(priority = false) {
  const elementRef = useRef<T | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(priority);

  useEffect(() => {
    if (priority || isNearViewport) return;

    const element = elementRef.current;
    if (!element) return;

    if (typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setIsNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: IMAGE_PRELOAD_ROOT_MARGIN }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [isNearViewport, priority]);

  return { elementRef, isNearViewport: priority || isNearViewport };
}
