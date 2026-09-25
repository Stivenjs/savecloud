import { useEffect, useRef } from "react";
import { useShellUiStore } from "@store/ShellUiStore";

/**
 * Registra un manejador de “atrás” (botón B / Escape una vez cerrado el menú lateral).
 * Varios manejadores pueden coexistir: se prueban del último montado al primero (LIFO).
 * Devuelve `true` si el evento quedó resuelto (no se invoca el siguiente manejador).
 *
 * El callback puede cambiar en cada render: internamente se usa un ref para no re-registrar
 * ni disparar re-suscripciones (patrón “latest handler”).
 */
export function useRegisterGlobalBack(handler: () => boolean) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const invoke = () => handlerRef.current();
    return useShellUiStore.getState().registerBackHandler(invoke);
  }, []);
}
