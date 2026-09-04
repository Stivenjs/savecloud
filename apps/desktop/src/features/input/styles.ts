import { InputMode } from "@features/input/types";

/**
 * Retorna las clases de Tailwind para el foco del Gamepad.
 * @param isFocused - Si el elemento está enfocado actualmente en el store
 * @param mode - El modo de input actual ("gamepad" | "mouse")
 * @param baseClasses - (Opcional) Clases extra que el componente ya tenga
 */
export function getGamepadFocusClass(isFocused: boolean, mode: InputMode, baseClasses: string = "") {
  const focusClasses =
    isFocused && mode === "gamepad"
      ? "ring-4 ring-primary ring-offset-[3px] ring-offset-black scale-[1.02] z-20 shadow-xl shadow-primary/20 transform-gpu will-change-transform [backface-visibility:hidden]"
      : "transform-gpu [backface-visibility:hidden]";

  return `${baseClasses} transition-all duration-200 ease-out ${focusClasses}`.trim();
}
