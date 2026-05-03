/**
 * Etiquetas amigables para nombres internos de gilrs (`Debug` de `Button` / claves de `Axis`).
 * El perfil se infiere del nombre del dispositivo; si no coincide, se usa «genérico» (leyenda tipo Xbox).
 */

export type GamepadLayoutKind = "xbox" | "playstation" | "nintendo" | "generic";

/** Heurística por nombre que devuelve el SO / gilrs (sin VID fiable en el frontend). */
export function inferGamepadLayoutKind(deviceName: string): GamepadLayoutKind {
  const n = deviceName.toLowerCase();
  if (n.includes("xbox") || n.includes("microsoft") || n.includes("045e") || n.includes("xinput")) {
    return "xbox";
  }
  if (
    n.includes("sony") ||
    n.includes("dualsense") ||
    n.includes("dualshock") ||
    n.includes("playstation") ||
    /\bps[45]\b/.test(n) ||
    n.includes("wireless controller")
  ) {
    return "playstation";
  }
  if (n.includes("nintendo") || n.includes("switch") || n.includes("pro controller")) {
    return "nintendo";
  }
  return "generic";
}

type ButtonKey = string;

const BUTTON_LABELS: Record<GamepadLayoutKind, Partial<Record<ButtonKey, string>>> = {
  xbox: {
    South: "A",
    East: "B",
    North: "Y",
    West: "X",
    C: "C",
    Z: "Z",
    LeftTrigger: "Hombro izquierdo",
    LeftTrigger2: "Gatillo izquierdo",
    RightTrigger: "Hombro derecho",
    RightTrigger2: "Gatillo derecho",
    Select: "Ver / Vista",
    Start: "Menú",
    Mode: "Guía (Xbox)",
    LeftThumb: "Pulsar stick izquierdo",
    RightThumb: "Pulsar stick derecho",
    DPadUp: "Cruceta arriba",
    DPadDown: "Cruceta abajo",
    DPadLeft: "Cruceta izquierda",
    DPadRight: "Cruceta derecha",
  },
  playstation: {
    South: "Cruz",
    East: "Círculo",
    North: "Triángulo",
    West: "Cuadrado",
    C: "C",
    Z: "Z",
    LeftTrigger: "L1",
    LeftTrigger2: "L2",
    RightTrigger: "R1",
    RightTrigger2: "R2",
    Select: "Crear / Touch pad",
    Start: "Opciones",
    Mode: "Botón PS",
    LeftThumb: "Pulsar L3",
    RightThumb: "Pulsar R3",
    DPadUp: "Cruceta arriba",
    DPadDown: "Cruceta abajo",
    DPadLeft: "Cruceta izquierda",
    DPadRight: "Cruceta derecha",
  },
  nintendo: {
    South: "B",
    East: "A",
    North: "X",
    West: "Y",
    C: "C",
    Z: "Z",
    LeftTrigger: "ZL",
    LeftTrigger2: "ZL (analog)",
    RightTrigger: "ZR",
    RightTrigger2: "ZR (analog)",
    Select: "−",
    Start: "+",
    Mode: "Inicio (casa)",
    LeftThumb: "Pulsar stick izquierdo",
    RightThumb: "Pulsar stick derecho",
    DPadUp: "Cruceta arriba",
    DPadDown: "Cruceta abajo",
    DPadLeft: "Cruceta izquierda",
    DPadRight: "Cruceta derecha",
  },
  generic: {
    South: "Botón sur (acción principal)",
    East: "Botón este",
    North: "Botón norte",
    West: "Botón oeste",
    C: "C",
    Z: "Z",
    LeftTrigger: "Hombro / gatillo izq. (tope)",
    LeftTrigger2: "Gatillo izquierdo",
    RightTrigger: "Hombro / gatillo der. (tope)",
    RightTrigger2: "Gatillo derecho",
    Select: "Seleccionar / compartir",
    Start: "Inicio / menú",
    Mode: "Botón central / guía",
    LeftThumb: "Stick izquierdo (pulsar)",
    RightThumb: "Stick derecho (pulsar)",
    DPadUp: "Cruceta arriba",
    DPadDown: "Cruceta abajo",
    DPadLeft: "Cruceta izquierda",
    DPadRight: "Cruceta derecha",
  },
};

/** Convierte un nombre técnico de botón (gilrs) a texto para la UI. */
export function friendlyButtonLabel(kind: GamepadLayoutKind, gilrsButtonName: string): string {
  const key = gilrsButtonName.trim();
  const table = BUTTON_LABELS[kind] ?? BUTTON_LABELS.generic;
  const hit = table[key];
  if (hit) return hit;
  const genericHit = BUTTON_LABELS.generic[key];
  if (genericHit && kind !== "generic") return genericHit;
  return `Botón (${key})`;
}

/** Lista de botones pulsados, ya legible. */
export function formatPressedButtonsDisplay(kind: GamepadLayoutKind, pressed: string[]): string {
  if (pressed.length === 0) return "";
  return pressed.map((b) => friendlyButtonLabel(kind, b)).join(" · ");
}

/** Títulos de filas para ejes analógicos (sin jerga LeftStickX). */
/** Texto corto para explicar cómo nombramos los botones. */
export function layoutKindDescription(kind: GamepadLayoutKind): string {
  switch (kind) {
    case "xbox":
      return "como en un mando Xbox";
    case "playstation":
      return "como en un mando PlayStation";
    case "nintendo":
      return "como en un mando de Nintendo Switch";
    default:
      return "en modo general (si no reconocemos la marca)";
  }
}

export function axisRowCopy(kind: GamepadLayoutKind): {
  triggers: { left: string; right: string };
  sticks: { left: string; right: string };
  dpad: string;
} {
  const base = {
    triggers: { left: "Gatillo izquierdo", right: "Gatillo derecho" },
    sticks: { left: "Stick izquierdo", right: "Stick derecho" },
    dpad: "Cruceta (inclinación)",
  };
  if (kind === "playstation") {
    return {
      triggers: { left: "L2 (presión)", right: "R2 (presión)" },
      sticks: { left: "Stick izquierdo", right: "Stick derecho" },
      dpad: "Cruceta (inclinación)",
    };
  }
  return base;
}
