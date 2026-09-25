import { create } from "zustand";

interface ShellUiStore {
  /**
   * Biblioteca en modo consola: término de búsqueda y setter registrados desde GamesPage.
   * La rail superior global lee esto en la ruta `/`.
   */
  gamesBpSearchTerm: string;
  gamesBpSearchSetValue: ((value: string) => void) | null;
  setGamesBpSearchTerm: (term: string) => void;
  registerGamesBpSearchValueSetter: (setter: ((value: string) => void) | null) => void;

  catalogBpSearchTerm: string;
  catalogBpSearchSetValue: ((value: string) => void) | null;
  setCatalogBpSearchTerm: (term: string) => void;
  registerCatalogBpSearchValueSetter: (setter: ((value: string) => void) | null) => void;

  /** Contador: cada incremento dispara un toggle del menú lateral (StaggeredMenu). */
  staggeredMenuToggleRequest: number;
  /** Contador: cada incremento pide abrir el drawer de perfil (GamesPage). */
  profileOpenRequest: number;
  /** Contador: cada incremento hace toggle del drawer (mando Share / perfil repetido). */
  profileToggleRequest: number;
  /** Si el menú lateral está abierto (lo actualiza StaggeredMenu vía AppLayout). */
  sideMenuOpen: boolean;
  /** Contador: cada incremento pide cerrar el menú lateral sin toggle (p. ej. botón B / Escape). */
  sideMenuCloseRequest: number;
  /**
   * Manejadores de “atrás” (B / Escape), en orden de registro.
   * En `requestGlobalBack` se invocan del último al primero (LIFO): gana el overlay más reciente.
   */
  backHandlers: Array<() => boolean>;
  requestStaggeredMenuToggle: () => void;
  requestProfileOpen: () => void;
  requestProfileToggle: () => void;
  setSideMenuOpen: (open: boolean) => void;
  requestCloseSideMenu: () => void;
  /** Cierra el menú lateral si está abierto; si no, `requestGlobalBack` (misma lógica que B / Escape). Retorna true si fue manejado. */
  dispatchBackNavigation: () => boolean;
  /** Registra un manejador; devuelve función para desregistrar al desmontar. */
  registerBackHandler: (handler: () => boolean) => () => void;
  requestGlobalBack: () => boolean;
  /** Diccionario unificado de posiciones de scroll por vista/ruta. */
  scrollPositions: Record<string, number>;
  /** Guarda la posición de scroll para una clave dada. */
  setScrollPosition: (key: string, position: number) => void;
  /** Obtiene la posición de scroll para una clave dada. */
  getScrollPosition: (key: string) => number;

  /** Posición del scroll del catálogo (legacy). */
  catalogScrollPosition: number;
  /** Establece la posición del scroll del catálogo (legacy). */
  setCatalogScrollPosition: (position: number) => void;
  /** Posición del scroll de la biblioteca (legacy). */
  libraryScrollPosition: number;
  /** Establece la posición del scroll de la biblioteca (legacy). */
  setLibraryScrollPosition: (position: number) => void;

  /**
   * Petición desde otra ventana (p. ej. Ajustes) para abrir el asistente «Traer a este equipo» en la biblioteca.
   * Se incrementa `openRestoreFromCloudRequest` junto con el `gameId`; GamesPage consume y limpia el id.
   */
  openRestoreFromCloudRequest: number;
  openRestoreFromCloudGameId: string | null;
  requestOpenRestoreFromCloud: (gameId: string) => void;
}

export const useShellUiStore = create<ShellUiStore>((set, get) => ({
  gamesBpSearchTerm: "",
  gamesBpSearchSetValue: null,
  setGamesBpSearchTerm: (term) => set({ gamesBpSearchTerm: term }),
  registerGamesBpSearchValueSetter: (setter) => set({ gamesBpSearchSetValue: setter }),

  catalogBpSearchTerm: "",
  catalogBpSearchSetValue: null,
  setCatalogBpSearchTerm: (term) => set({ catalogBpSearchTerm: term }),
  registerCatalogBpSearchValueSetter: (setter) => set({ catalogBpSearchSetValue: setter }),

  staggeredMenuToggleRequest: 0,
  profileOpenRequest: 0,
  profileToggleRequest: 0,
  sideMenuOpen: false,
  sideMenuCloseRequest: 0,
  backHandlers: [],
  requestStaggeredMenuToggle: () => set((s) => ({ staggeredMenuToggleRequest: s.staggeredMenuToggleRequest + 1 })),
  requestProfileOpen: () => set((s) => ({ profileOpenRequest: s.profileOpenRequest + 1 })),
  requestProfileToggle: () => set((s) => ({ profileToggleRequest: s.profileToggleRequest + 1 })),
  setSideMenuOpen: (open) => set({ sideMenuOpen: open }),
  requestCloseSideMenu: () => set((s) => ({ sideMenuCloseRequest: s.sideMenuCloseRequest + 1 })),
  dispatchBackNavigation: () => {
    const s = get();
    if (s.sideMenuOpen) {
      s.requestCloseSideMenu();
      return true;
    }
    return s.requestGlobalBack();
  },
  registerBackHandler: (handler) => {
    set((s) => ({ backHandlers: [...s.backHandlers, handler] }));
    return () => {
      set((s) => ({ backHandlers: s.backHandlers.filter((h) => h !== handler) }));
    };
  },
  requestGlobalBack: () => {
    const list = get().backHandlers;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]()) return true;
    }
    return false;
  },
  scrollPositions: {},
  setScrollPosition: (key, position) =>
    set((s) => ({
      scrollPositions: { ...s.scrollPositions, [key]: position },
      ...(key === "catalog" ? { catalogScrollPosition: position } : {}),
      ...(key === "library" ? { libraryScrollPosition: position } : {}),
    })),
  getScrollPosition: (key) =>
    get().scrollPositions[key] ??
    (key === "catalog" ? get().catalogScrollPosition : key === "library" ? get().libraryScrollPosition : 0),
  catalogScrollPosition: 0,
  setCatalogScrollPosition: (position) =>
    set((s) => ({
      catalogScrollPosition: position,
      scrollPositions: { ...s.scrollPositions, catalog: position },
    })),
  libraryScrollPosition: 0,
  setLibraryScrollPosition: (position) =>
    set((s) => ({
      libraryScrollPosition: position,
      scrollPositions: { ...s.scrollPositions, library: position },
    })),

  openRestoreFromCloudRequest: 0,
  openRestoreFromCloudGameId: null,
  requestOpenRestoreFromCloud: (gameId) =>
    set((s) => ({
      openRestoreFromCloudGameId: gameId.trim(),
      openRestoreFromCloudRequest: s.openRestoreFromCloudRequest + 1,
    })),
}));
