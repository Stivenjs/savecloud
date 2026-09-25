/** Mismo import dinámico que el `lazy()` de la ruta `/games/:gameId` — precarga el chunk JS al hacer hover. */
export function preloadGameDetailModule() {
  return import("@features/game-detail");
}
