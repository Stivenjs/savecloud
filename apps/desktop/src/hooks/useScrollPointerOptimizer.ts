import { useEffect, type RefObject } from "react";

/**
 * Hook para optimizar el rendimiento del scroll desactivando eventos de puntero
 * y micro-animaciones CSS (:hover, escalas, sombras con desenfoque alto) mientras
 * el usuario se desplaza rápido.
 *
 * Agrega temporalmente la clase `.sg-is-scrolling` al elemento contenedor, permitiendo
 * que el hilo compositor de la GPU mantenga 60/120+ fps nativos sin pausas por hit-testing.
 *
 * @param containerRef Referencia al elemento HTML contenedor de los ítems.
 * @param debounceMs Milisegundos de inactividad antes de reanudar eventos de puntero (por defecto 100ms).
 */
export function useScrollPointerOptimizer(containerRef: RefObject<HTMLElement | null>, debounceMs = 100) {
  useEffect(() => {
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (!container.classList.contains("sg-is-scrolling")) {
        container.classList.add("sg-is-scrolling");
      }
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        container.classList.remove("sg-is-scrolling");
      }, debounceMs);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (scrollTimer) clearTimeout(scrollTimer);
      container.classList.remove("sg-is-scrolling");
    };
  }, [containerRef, debounceMs]);
}
