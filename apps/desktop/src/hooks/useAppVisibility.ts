import { useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

type VoidFn = () => void;

interface VisibilitySubscription {
  onPause: VoidFn;
  onResume: VoidFn;
}

/**
 * Singleton que gestiona el estado global de visibilidad de la app.
 *
 * Combina dos fuentes:
 *  1. `document.visibilityState` — se activa al minimizar o cambiar de ventana.
 *  2. `appWindow.onFocusChanged` (Tauri v2) — cubre casos donde la ventana
 *     pierde el foco pero el documento no cambia de visibilidad.
 *
 * La app se considera "en background" si CUALQUIERA de las dos señales indica
 * que no está visible/enfocada.
 *
 * @example
 * // En un componente React:
 * const { isVisible } = useAppVisibility();
 *
 * // Fuera de React (ej. loops de animación):
 * const unsub = visibilityManager.subscribe(
 *   () => cancelAnimationFrame(frameId), // onPause
 *   () => { frameId = requestAnimationFrame(animate); } // onResume
 * );
 * // Llamar unsub() en el cleanup
 */
class AppVisibilityManager {
  private _isDocumentVisible = document.visibilityState === "visible";
  private _isWindowFocused = true;
  private _subscribers = new Set<VisibilitySubscription>();

  constructor() {
    this._init();
  }

  /** Estado actual: true si la app está visible y enfocada. */
  get isVisible(): boolean {
    return this._isDocumentVisible && this._isWindowFocused;
  }

  /**
   * Suscribe callbacks de pausa/reanudación.
   * @returns Función para cancelar la suscripción (llamar en cleanup).
   */
  subscribe(onPause: VoidFn, onResume: VoidFn): VoidFn {
    const sub: VisibilitySubscription = { onPause, onResume };
    this._subscribers.add(sub);
    return () => this._subscribers.delete(sub);
  }

  private _notify(wasVisible: boolean) {
    const nowVisible = this.isVisible;
    if (wasVisible === nowVisible) return;

    if (nowVisible) {
      this._subscribers.forEach((s) => s.onResume());
    } else {
      this._subscribers.forEach((s) => s.onPause());
    }
  }

  private _init() {
    const handleVisibilityChange = () => {
      const prev = this.isVisible;
      this._isDocumentVisible = document.visibilityState === "visible";
      this._notify(prev);
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    void getCurrentWebviewWindow()
      .onFocusChanged(({ payload: focused }) => {
        const prev = this.isVisible;
        this._isWindowFocused = focused;
        this._notify(prev);
      })
      .catch(() => {});
  }
}

/** Singleton exportado — usar directamente fuera de React. */
export const visibilityManager = new AppVisibilityManager();

/**
 * Hook que expone el estado de visibilidad de la app como valor reactivo.
 *
 * - `isVisible: true`  → la app está en primer plano y enfocada.
 * - `isVisible: false` → la app está minimizada, en background o sin foco.
 *
 * @example
 * function MyComponent() {
 *   const { isVisible } = useAppVisibility();
 *
 *   useEffect(() => {
 *     if (!isVisible) pauseMyAnimation();
 *     else resumeMyAnimation();
 *   }, [isVisible]);
 * }
 */
export function useAppVisibility() {
  const [isVisible, setIsVisible] = useState(() => visibilityManager.isVisible);

  useEffect(() => {
    setIsVisible(visibilityManager.isVisible);

    const unsub = visibilityManager.subscribe(
      () => setIsVisible(false), // onPause
      () => setIsVisible(true) // onResume
    );

    return unsub;
  }, []);

  return { isVisible };
}
