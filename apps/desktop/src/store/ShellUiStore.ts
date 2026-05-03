import { create } from "zustand";

interface ShellUiStore {
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
  /** Cierra el menú lateral si está abierto; si no, `requestGlobalBack` (misma lógica que B / Escape). */
  dispatchBackNavigation: () => void;
  /** Registra un manejador; devuelve función para desregistrar al desmontar. */
  registerBackHandler: (handler: () => boolean) => () => void;
  requestGlobalBack: () => void;
  /** Posición del scroll del catálogo. */
  catalogScrollPosition: number;
  /** Establece la posición del scroll del catálogo. */
  setCatalogScrollPosition: (position: number) => void;
}

export const useShellUiStore = create<ShellUiStore>((set, get) => ({
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
    if (s.sideMenuOpen) s.requestCloseSideMenu();
    else s.requestGlobalBack();
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
      if (list[i]()) return;
    }
  },
  catalogScrollPosition: 0,
  setCatalogScrollPosition: (position) => set({ catalogScrollPosition: position }),
}));
