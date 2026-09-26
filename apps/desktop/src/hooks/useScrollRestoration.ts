import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useShellUiStore } from "@store/ShellUiStore";

export interface UseScrollRestorationOptions {
  /** Callback opcional en cada evento de scroll (ej. para toolbars sticky). */
  onScroll?: (scrollY: number, isScrollingUp: boolean) => void;
  /** Dependencias que resetean la posición guardada a 0 (ej. al cambiar filtros o términos de búsqueda). */
  resetOnDeps?: unknown[];
}

export function useScrollRestoration(
  key: "library" | "catalog" | string,
  isReady = true,
  options?: UseScrollRestorationOptions
) {
  const { pathname } = useLocation();
  const isActiveRoute = key === "library" ? pathname === "/" : key === "catalog" ? pathname === "/catalog" : true;
  const getPosition = useShellUiStore((state) => state.getScrollPosition);
  const setPosition = useShellUiStore((state) => state.setScrollPosition);

  const targetScrollY = getPosition(key);
  const targetScrollYRef = useRef(targetScrollY);
  const hasRestoredRef = useRef(false);
  const isRestoringRef = useRef(targetScrollY > 0);
  const lastScrollYRef = useRef(targetScrollY);
  const isUnmountingRef = useRef(false);
  const previousResetDepsRef = useRef<unknown[]>(options?.resetOnDeps ? [...options.resetOnDeps] : []);

  const onScrollRef = useRef(options?.onScroll);
  onScrollRef.current = options?.onScroll;

  useLayoutEffect(() => {
    if (typeof history !== "undefined" && "scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    if (!isActiveRoute) return;

    isUnmountingRef.current = false;
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleScroll = () => {
      if (isRestoringRef.current || isUnmountingRef.current) return;

      const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;
      const isScrollingUp = currentScrollY < lastScrollYRef.current;
      lastScrollYRef.current = currentScrollY;

      if (currentScrollY >= 0) {
        if (saveTimeout) clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
          if (!isUnmountingRef.current) {
            setPosition(key, currentScrollY);
          }
        }, 150);
      }

      onScrollRef.current?.(currentScrollY, isScrollingUp);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      isUnmountingRef.current = true;
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
      if (lastScrollYRef.current >= 0) {
        setPosition(key, lastScrollYRef.current);
      }
      window.removeEventListener("scroll", handleScroll);
    };
  }, [isActiveRoute, key, setPosition]);

  useLayoutEffect(() => {
    if (hasRestoredRef.current || !isActiveRoute) return;

    const targetY = targetScrollYRef.current;
    if (targetY <= 0) {
      window.scrollTo({ top: 0, behavior: "instant" });
      hasRestoredRef.current = true;
      isRestoringRef.current = false;
      return;
    }
    if (!isReady) return;

    isRestoringRef.current = true;

    window.scrollTo({ top: targetY, behavior: "instant" });

    let attempts = 0;
    const maxAttempts = 12;

    const checkAndRestore = () => {
      const currentY = window.scrollY || document.documentElement.scrollTop || 0;
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

      if (Math.abs(currentY - targetY) < 4 || (maxScroll >= targetY && attempts > 1)) {
        window.scrollTo({ top: targetY, behavior: "instant" });
        hasRestoredRef.current = true;
        setTimeout(() => {
          isRestoringRef.current = false;
        }, 60);
        return;
      }

      if (attempts < maxAttempts) {
        attempts++;
        window.scrollTo({ top: targetY, behavior: "instant" });
        requestAnimationFrame(checkAndRestore);
      } else {
        window.scrollTo({ top: targetY, behavior: "instant" });
        hasRestoredRef.current = true;
        setTimeout(() => {
          isRestoringRef.current = false;
        }, 60);
      }
    };

    const rafId = requestAnimationFrame(checkAndRestore);
    return () => cancelAnimationFrame(rafId);
  }, [isActiveRoute, isReady]);

  useEffect(() => {
    const nextDeps = options?.resetOnDeps ?? [];
    const previousDeps = previousResetDepsRef.current;
    const hasChanged =
      previousDeps.length !== nextDeps.length ||
      nextDeps.some((dependency, index) => !Object.is(dependency, previousDeps[index]));

    previousResetDepsRef.current = [...nextDeps];
    if (!hasChanged || nextDeps.length === 0) return;

    targetScrollYRef.current = 0;
    lastScrollYRef.current = 0;
    setPosition(key, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, options?.resetOnDeps ?? []);

  return {
    isRestoring: isRestoringRef.current,
  };
}
