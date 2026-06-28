import { useMemo } from "react";

/**
 * Devuelve `true` cuando la ventana actual es una webview Big Picture
 * (la clase `savecloud-big-picture` está en `<html>`).
 *
 * Centraliza la detección que antes se repetía manualmente en
 * `GamesPage`, `SteamCatalogPage`, etc.
 */
export function useBigPictureConsole(): boolean {
  return useMemo(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("savecloud-big-picture"),
    []
  );
}
