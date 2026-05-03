import type { FaceButtonKey } from "@/lib/kenneyGamepadAssets";
import type { KenneyChassisProfile } from "@/lib/kenneyGamepadAssets";

export const STICK_DEADZONE = 0.12;
export const STICK_NUB_PX = 14;
export const TRIGGER_BAR_H = 52;
export const DPAD_AXIS = 0.35;

/** Vista exterior (viewBox 420×200) si no hay silueta Kenney resuelta. */
export const GEOM_DEFAULT = {
  dpad: [108, 118] as const,
  stickL: [200, 128] as const,
  stickR: [292, 128] as const,
  face: {
    North: [348, 82],
    West: [312, 118],
    East: [384, 118],
    South: [348, 154],
  } satisfies Record<FaceButtonKey, readonly [number, number]>,
  select: [232, 72] as const,
  start: [278, 72] as const,
  mode: [210, 100] as const,
  shoulderL: [92, 38, 56, 14] as const,
  shoulderR: [272, 38, 56, 14] as const,
  triggerLx: 52,
  triggerRx: 346,
} as const;

/**
 * Geometría HUD en espacio 64×64 del **mismo** `controller_*.svg` que la silueta.
 * Los centros deben salir **todos** del mismo archivo (huecos = subpaths circulares antes del contorno),
 * no mezclar criterios por pieza o el HUD “camina” respecto a los agujeros negros.
 */
export type KenneyIconGeom = {
  dpad: readonly [number, number];
  stickL: readonly [number, number];
  stickR: readonly [number, number];
  stickRingR: number;
  stickNubR: number;
  nubTravel: number;
  face: Record<FaceButtonKey, readonly [number, number]>;
  faceIcon: number;
  select: readonly [number, number];
  start: readonly [number, number];
  mode: readonly [number, number];
  centerIcon: number;
  triggerTrack: { h: number; w: number; leftX: number; rightX: number; top: number };
  shoulderL: readonly [number, number, number, number];
  shoulderR: readonly [number, number, number, number];
};

export const ICON_GEOM: Record<KenneyChassisProfile, KenneyIconGeom> = {
  xbox: {
    dpad: [26, 34],
    stickL: [20.5, 25.5],
    stickR: [36, 34],
    stickRingR: 3.25,
    stickNubR: 1.28,
    nubTravel: 1.0,
    face: {
      North: [43, 23],
      West: [39, 27],
      East: [47, 27],
      South: [43, 31],
    },
    faceIcon: 4.05,
    select: [28.1, 21.6],
    start: [35.9, 21.6],
    mode: [32, 22],
    centerIcon: 3.85,
    triggerTrack: { h: 9.5, w: 4, leftX: 13.8, rightX: 46.2, top: 6.4 },
    shoulderL: [9.4, 15.2, 8.6, 2.85],
    shoulderR: [46, 15.2, 8.6, 2.85],
  },

  playstation: {
    dpad: [18, 26],
    stickL: [25, 32],
    stickR: [39, 32],
    stickRingR: 2.65,
    stickNubR: 1.26,
    nubTravel: 1.0,
    face: {
      North: [46.5, 23.5],
      West: [43.5, 26.5],
      East: [49.5, 26.5],
      South: [46.5, 29.5],
    },
    faceIcon: 4.15,
    select: [26.2, 20.8],
    start: [37.8, 20.8],
    mode: [32, 22],
    centerIcon: 3.65,
    triggerTrack: { h: 9.2, w: 3.9, leftX: 14.1, rightX: 46, top: 6.1 },
    shoulderL: [10, 14.6, 7.9, 2.75],
    shoulderR: [46.1, 14.6, 7.9, 2.75],
  },

  nintendo: {
    dpad: [25, 32],
    stickL: [19, 24],
    stickR: [38, 32],
    stickRingR: 2.85,
    stickNubR: 1.26,
    nubTravel: 1.0,
    face: {
      North: [45, 22],
      West: [41, 25],
      East: [49, 25],
      South: [45, 28],
    },
    faceIcon: 4.1,
    select: [28.4, 18.6],
    start: [35.6, 18.6],
    mode: [32, 17],
    centerIcon: 3.55,
    triggerTrack: { h: 9, w: 3.85, leftX: 14, rightX: 46.15, top: 5.7 },
    shoulderL: [9.8, 14, 8.2, 2.65],
    shoulderR: [46, 14, 8.2, 2.65],
  },
};

/** ViewBox del modo silueta Kenney (64×64 escalado igual para todas las plataformas). */
export const SHELL_VB_W = 640;
export const SHELL_VB_H = 430;
export const SHELL_ICON_SCALE = Math.min((SHELL_VB_W - 36) / 64, (SHELL_VB_H - 32) / 64);
export const SHELL_PAD_X = (SHELL_VB_W - 64 * SHELL_ICON_SCALE) / 2;
export const SHELL_PAD_Y = (SHELL_VB_H - 64 * SHELL_ICON_SCALE) / 2;

export function pressedSet(pressed: string[]): Set<string> {
  return new Set(pressed.map((p) => p.trim()));
}

export function isActive(set: Set<string>, key: string): boolean {
  return set.has(key);
}

export function stickOffset(axisX: number, axisY: number, nubPx: number): { x: number; y: number } {
  const x = Math.abs(axisX) > STICK_DEADZONE ? axisX * nubPx : 0;
  const y = Math.abs(axisY) > STICK_DEADZONE ? axisY * nubPx : 0;
  return { x, y };
}

export function dpadDirections(set: Set<string>, dpx: number, dpy: number) {
  return {
    up: isActive(set, "DPadUp") || dpy < -DPAD_AXIS,
    down: isActive(set, "DPadDown") || dpy > DPAD_AXIS,
    left: isActive(set, "DPadLeft") || dpx < -DPAD_AXIS,
    right: isActive(set, "DPadRight") || dpx > DPAD_AXIS,
  };
}

export function padShape(on: boolean): string {
  return on
    ? "fill-primary stroke-primary-600 stroke-[1.2px] dark:stroke-primary-400"
    : "fill-default-200/90 stroke-default-300/70 dark:fill-default-800/35 dark:stroke-default-500/50";
}

export function padText(on: boolean): string {
  return on ? "fill-white dark:fill-default-950" : "fill-default-700 dark:fill-default-200";
}
