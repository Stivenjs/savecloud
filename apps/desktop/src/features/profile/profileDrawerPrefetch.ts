/**
 * Precarga el chunk del drawer de perfil antes de abrirlo (idle o hover).
 * El import dinámico está deduplicado por el bundler.
 */
export function prefetchProfileDrawer(): void {
  void import("@features/profile/ProfileDrawer");
}
