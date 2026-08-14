import { useEffect, useLayoutEffect, useRef } from "react";

const SCROLL_STORAGE_KEY = "savecloud_catalog_scroll_y";

export function useCatalogScrollRestoration(itemsLength: number, isReady: boolean) {
  const restoredRef = useRef(false);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 0) {
        sessionStorage.setItem(SCROLL_STORAGE_KEY, String(window.scrollY));
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useLayoutEffect(() => {
    if (restoredRef.current || !isReady || itemsLength === 0) return;

    const savedY = sessionStorage.getItem(SCROLL_STORAGE_KEY);
    if (savedY) {
      const scrollY = parseInt(savedY, 10);
      if (!isNaN(scrollY) && scrollY > 0) {
        window.scrollTo({ top: scrollY, behavior: "instant" });

        requestAnimationFrame(() => {
          window.scrollTo({ top: scrollY, behavior: "instant" });
        });
      }
    }
    restoredRef.current = true;
  }, [itemsLength, isReady]);

  const clearSavedScroll = () => {
    sessionStorage.removeItem(SCROLL_STORAGE_KEY);
    restoredRef.current = true;
  };

  return { clearSavedScroll };
}
