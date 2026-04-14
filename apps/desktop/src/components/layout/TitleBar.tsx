import { useEffect, useState, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type as getOsType } from "@tauri-apps/plugin-os";

/**
 * Define el estado actual de la ventana y las funciones de control.
 */
export interface WindowControls {
  /** Indica si la ventana está maximizada actualmente. */
  isMaximized: boolean;
  /** El sistema operativo detectado ("macos", "windows", etc.). */
  platform: string;
  /** Minimiza la ventana a la barra de tareas o dock. */
  minimize: () => void;
  /** Alterna entre maximizar y restaurar la ventana. */
  maximize: () => void;
  /** Cierra la ventana y termina el proceso si es la única abierta. */
  close: () => void;
}

/**
 * Hook personalizado para manejar el estado y las acciones de la ventana de Tauri.
 * Encapsula la lógica de los listeners y llamadas a la API nativa.
 * * @returns {WindowControls} Estado y controles de la ventana.
 */
function useTauriWindow(): WindowControls {
  const [isMaximized, setIsMaximized] = useState(false);
  const [platform, setPlatform] = useState("windows");
  const appWindow = getCurrentWindow();

  useEffect(() => {
    let unlistenResize: (() => void) | undefined;

    const initWindowState = async () => {
      try {
        const osType = await getOsType();
        setPlatform(osType);

        const maximized = await appWindow.isMaximized();
        setIsMaximized(maximized);

        // Escuchar cambios de tamaño para actualizar el icono de maximizar/restaurar
        unlistenResize = await appWindow.onResized(async () => {
          setIsMaximized(await appWindow.isMaximized());
        });
      } catch (error) {
        console.warn("Tauri APIs no disponibles (probablemente ejecutándose en navegador):", error);
      }
    };

    initWindowState();

    // Limpieza del listener al desmontar el componente
    return () => {
      if (unlistenResize) {
        unlistenResize();
      }
    };
  }, [appWindow]);

  const minimize = useCallback(() => appWindow.minimize(), [appWindow]);
  const maximize = useCallback(() => appWindow.toggleMaximize(), [appWindow]);
  const close = useCallback(() => appWindow.close(), [appWindow]);

  return { isMaximized, platform, minimize, maximize, close };
}

/**
 * Componente que renderiza los controles de ventana estilo macOS.
 */
const MacControls = ({ close, minimize, maximize }: Pick<WindowControls, "close" | "minimize" | "maximize">) => (
  <>
    <div className="flex items-center h-full px-4 gap-2">
      <button
        onClick={close}
        className="w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff5f57]/80 flex items-center justify-center group"
        aria-label="Cerrar">
        <svg className="w-2 h-2 opacity-0 group-hover:opacity-100" viewBox="0 0 10 10" fill="currentColor">
          <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <button
        onClick={minimize}
        className="w-3 h-3 rounded-full bg-[#febc2e] hover:bg-[#febc2e]/80 flex items-center justify-center group"
        aria-label="Minimizar">
        <svg className="w-2 h-2 opacity-0 group-hover:opacity-100" viewBox="0 0 10 10" fill="currentColor">
          <rect y="4" width="10" height="2" />
        </svg>
      </button>
      <button
        onClick={maximize}
        className="w-3 h-3 rounded-full bg-[#28c840] hover:bg-[#28c840]/80 flex items-center justify-center group"
        aria-label="Maximizar">
        <svg className="w-2 h-2 opacity-0 group-hover:opacity-100" viewBox="0 0 10 10" fill="currentColor">
          <path d="M1 5L5 1L9 5L5 9Z" />
        </svg>
      </button>
    </div>
    <div data-tauri-drag-region className="flex-1 h-full" />
    <div className="flex items-center h-full px-4 pointer-events-none">
      <span className="text-sm font-medium text-foreground/80">SaveCloud</span>
    </div>
  </>
);

/**
 * Componente que renderiza los controles de ventana estilo Windows.
 */
const WindowsControls = ({ close, minimize, maximize, isMaximized }: Omit<WindowControls, "platform">) => (
  <>
    <div data-tauri-drag-region className="flex-1 h-full flex items-center px-4">
      <span className="text-sm font-medium text-foreground/80 pointer-events-none">SaveCloud</span>
    </div>
    <div className="flex items-center h-full">
      <button
        onClick={minimize}
        className="w-12 h-full flex items-center justify-center hover:bg-white/10 transition-colors"
        aria-label="Minimizar">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <rect y="5" width="12" height="2" />
        </svg>
      </button>
      <button
        onClick={maximize}
        className="w-12 h-full flex items-center justify-center hover:bg-white/10 transition-colors"
        aria-label={isMaximized ? "Restaurar" : "Maximizar"}>
        {isMaximized ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M1 3v8h8V3H1zm7 7H2V4h6v6z" />
            <path d="M3 1h8v8h-1V2H3V1z" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <rect x="1" y="1" width="10" height="10" stroke="currentColor" fill="none" strokeWidth="2" />
          </svg>
        )}
      </button>
      <button
        onClick={close}
        className="w-12 h-full flex items-center justify-center hover:bg-red-500 hover:text-white transition-colors"
        aria-label="Cerrar">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
    </div>
  </>
);

/**
 * Barra de título personalizada para la aplicación Tauri.
 * Se adapta automáticamente al sistema operativo anfitrión (macOS o Windows).
 */
export function TitleBar() {
  const { isMaximized, platform, minimize, maximize, close } = useTauriWindow();
  const isMac = platform === "macos";

  return (
    <div
      data-tauri-drag-region
      className="fixed top-0 left-0 right-0 z-50 h-10 bg-transparent flex items-center justify-between select-none">
      {isMac ? (
        <MacControls close={close} minimize={minimize} maximize={maximize} />
      ) : (
        <WindowsControls close={close} minimize={minimize} maximize={maximize} isMaximized={isMaximized} />
      )}
    </div>
  );
}
