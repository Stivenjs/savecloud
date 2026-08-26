import { useEffect, useLayoutEffect, useRef } from "react";
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
  const getPosition = useShellUiStore((state) => state.getScrollPosition);
  const setPosition = useShellUiStore((state) => state.setScrollPosition);

  // Leer la posición guardada para esta vista
  const targetScrollY = getPosition(key);
  const targetScrollYRef = useRef(targetScrollY);
  const hasRestoredRef = useRef(false);
  const isRestoringRef = useRef(targetScrollY > 0);
  const lastScrollYRef = useRef(targetScrollY);
  const isUnmountingRef = useRef(false);

  // Mantener callback actualizado en ref para evitar recrear listeners en cada render
  const onScrollRef = useRef(options?.onScroll);
  onScrollRef.current = options?.onScroll;

  // Desactivar scrollRestoration automático del navegador
  useLayoutEffect(() => {
    if (typeof history !== "undefined" && "scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
  }, []);

  // Escuchar scroll del usuario
  useEffect(() => {
    isUnmountingRef.current = false;

    const handleScroll = () => {
      // Ignorar eventos de scroll durante la restauración automática o el desmontaje hacia otra página
      if (isRestoringRef.current || isUnmountingRef.current) return;

      const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;
      const isScrollingUp = currentScrollY < lastScrollYRef.current;
      lastScrollYRef.current = currentScrollY;

      // Solo guardamos si el componente sigue activo y el usuario realmente scrolleó
      if (currentScrollY >= 0) {
        setPosition(key, currentScrollY);
      }

      onScrollRef.current?.(currentScrollY, isScrollingUp);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      // Marcar desmontaje para que ningún scrollTo(0) de la página entrante borre el scroll
      isUnmountingRef.current = true;
      window.removeEventListener("scroll", handleScroll);
    };
  }, [key, setPosition]);

  // Restauración síncrona y continua hasta que el DOM alcance la altura requerida
  useLayoutEffect(() => {
    if (hasRestoredRef.current || !isReady) return;

    const targetY = targetScrollYRef.current;
    if (targetY <= 0) {
      hasRestoredRef.current = true;
      isRestoringRef.current = false;
      return;
    }

    isRestoringRef.current = true;

    // Intentar aplicar scroll inmediatamente
    window.scrollTo({ top: targetY, behavior: "instant" });

    let attempts = 0;
    const maxAttempts = 12; // ~200ms a 60fps

    const checkAndRestore = () => {
      const currentY = window.scrollY || document.documentElement.scrollTop || 0;
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

      // Si el DOM ya creció lo suficiente o alcanzamos el target
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
        // Fallback final tras agotar intentos
        window.scrollTo({ top: targetY, behavior: "instant" });
        hasRestoredRef.current = true;
        setTimeout(() => {
          isRestoringRef.current = false;
        }, 60);
      }
    };

    const rafId = requestAnimationFrame(checkAndRestore);
    return () => cancelAnimationFrame(rafId);
  }, [isReady]);

  // Resetear la posición si cambian las dependencias de filtro/búsqueda
  useEffect(() => {
    if (options?.resetOnDeps && options.resetOnDeps.length > 0) {
      targetScrollYRef.current = 0;
      setPosition(key, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, options?.resetOnDeps ?? []);

  return {
    isRestoring: isRestoringRef.current,
  };
}
