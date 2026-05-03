import { useCallback, useMemo } from "react";
import type { GamepadLayoutKind } from "@/lib/gamepadLabelMaps";
import { BUTTON_FACE_LABELS } from "@/lib/gamepadLabelMaps";
import {
  getKenneyControllerChassisUrl,
  getKenneyGamepadAssetUrl,
  kenneyAnalogTriggerAssetId,
  kenneyBumperAssetId,
  kenneyChassisProfile,
  kenneyModeAssetId,
  kenneySelectAssetId,
  kenneyStartAssetId,
  kenneyStickBaseAssetId,
  kenneyStickPressAssetId,
} from "@/lib/kenneyGamepadAssets";
import type { GamepadTelemetryDto } from "@/hooks/useGamepadTester";
import { gamepadAxisValue, gamepadTriggerLevel } from "@/hooks/useGamepadTester";
import {
  dpadDirections,
  GEOM_DEFAULT,
  ICON_GEOM,
  type KenneyIconGeom,
  isActive,
  pressedSet,
  SHELL_PAD_X,
  SHELL_PAD_Y,
  SHELL_ICON_SCALE,
  SHELL_VB_H,
  SHELL_VB_W,
  stickOffset,
  STICK_NUB_PX,
  TRIGGER_BAR_H,
} from "@/constants/gamepadDiagramConstants";

export interface UseGamepadDiagramArgs {
  layoutKind: GamepadLayoutKind;
  telemetry: GamepadTelemetryDto;
}

export interface UseGamepadDiagramResult {
  layoutKind: GamepadLayoutKind;
  set: Set<string>;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  lz: number;
  rz: number;
  dpx: number;
  dpy: number;
  leftNubOuter: { x: number; y: number };
  rightNubOuter: { x: number; y: number };
  leftNubShell: { x: number; y: number };
  rightNubShell: { x: number; y: number };
  d: ReturnType<typeof dpadDirections>;
  face: (typeof BUTTON_FACE_LABELS)[GamepadLayoutKind];
  selectHref: string | undefined;
  startHref: string | undefined;
  modeHref: string | undefined;
  leftStickDecal: string | undefined;
  rightStickDecal: string | undefined;
  leftStickPress: string | undefined;
  rightStickPress: string | undefined;
  leftTriggerHref: string | undefined;
  rightTriggerHref: string | undefined;
  leftBumperHref: string | undefined;
  rightBumperHref: string | undefined;
  geom: typeof GEOM_DEFAULT;
  shellHref: string | undefined;
  iconGeom: KenneyIconGeom;
  tt: KenneyIconGeom["triggerTrack"];
  svgViewBox: string;
  shoulderOn: (digital: string) => boolean;
  /** Hombreras (gilrs: `LeftTrigger2` / `RightTrigger2`). */
  bumperOn: (side: "left" | "right") => boolean;
  shellPadX: number;
  shellPadY: number;
  shellIconScale: number;
  triggerBarH: number;
}

export function useGamepadDiagram({ layoutKind, telemetry }: UseGamepadDiagramArgs): UseGamepadDiagramResult {
  const axes = telemetry.axes;
  const set = useMemo(() => pressedSet(telemetry.pressed_buttons), [telemetry.pressed_buttons]);

  const lx = gamepadAxisValue(axes, "LeftStickX");
  const ly = gamepadAxisValue(axes, "LeftStickY");
  const rx = gamepadAxisValue(axes, "RightStickX");
  const ry = gamepadAxisValue(axes, "RightStickY");
  const lz = useMemo(
    () => gamepadTriggerLevel(axes, telemetry.button_values, set, "left"),
    [axes, telemetry.button_values, set]
  );
  const rz = useMemo(
    () => gamepadTriggerLevel(axes, telemetry.button_values, set, "right"),
    [axes, telemetry.button_values, set]
  );
  const dpx = gamepadAxisValue(axes, "DPadX");
  const dpy = gamepadAxisValue(axes, "DPadY");

  const leftNubOuter = stickOffset(lx, ly, STICK_NUB_PX);
  const rightNubOuter = stickOffset(rx, ry, STICK_NUB_PX);
  const d = dpadDirections(set, dpx, dpy);

  const face = BUTTON_FACE_LABELS[layoutKind];

  const selectHref = getKenneyGamepadAssetUrl(layoutKind, kenneySelectAssetId(layoutKind));
  const startHref = getKenneyGamepadAssetUrl(layoutKind, kenneyStartAssetId(layoutKind));
  const modeHref = getKenneyGamepadAssetUrl(layoutKind, kenneyModeAssetId(layoutKind));

  const leftStickDecal = getKenneyGamepadAssetUrl(layoutKind, kenneyStickBaseAssetId(layoutKind, "left")) ?? undefined;
  const rightStickDecal =
    getKenneyGamepadAssetUrl(layoutKind, kenneyStickBaseAssetId(layoutKind, "right")) ?? undefined;
  const leftStickPress = getKenneyGamepadAssetUrl(layoutKind, kenneyStickPressAssetId(layoutKind, "left")) ?? undefined;
  const rightStickPress =
    getKenneyGamepadAssetUrl(layoutKind, kenneyStickPressAssetId(layoutKind, "right")) ?? undefined;

  const leftTriggerHref = getKenneyGamepadAssetUrl(layoutKind, kenneyAnalogTriggerAssetId(layoutKind, "left"));
  const rightTriggerHref = getKenneyGamepadAssetUrl(layoutKind, kenneyAnalogTriggerAssetId(layoutKind, "right"));
  const leftBumperHref = getKenneyGamepadAssetUrl(layoutKind, kenneyBumperAssetId(layoutKind, "left"));
  const rightBumperHref = getKenneyGamepadAssetUrl(layoutKind, kenneyBumperAssetId(layoutKind, "right"));

  const shellHref = getKenneyControllerChassisUrl(layoutKind);
  const iconGeom = ICON_GEOM[kenneyChassisProfile(layoutKind)];
  const leftNubShell = stickOffset(lx, ly, iconGeom.nubTravel);
  const rightNubShell = stickOffset(rx, ry, iconGeom.nubTravel);

  const shoulderOn = useCallback(
    (digital: string) =>
      isActive(set, digital) || (digital === "LeftTrigger" && lz > 0.1) || (digital === "RightTrigger" && rz > 0.1),
    [set, lz, rz]
  );

  const bumperOn = useCallback(
    (side: "left" | "right") => isActive(set, side === "left" ? "LeftTrigger2" : "RightTrigger2"),
    [set]
  );

  const svgViewBox = shellHref ? `0 0 ${SHELL_VB_W} ${SHELL_VB_H}` : "0 0 420 200";

  return {
    layoutKind,
    set,
    lx,
    ly,
    rx,
    ry,
    lz,
    rz,
    dpx,
    dpy,
    leftNubOuter,
    rightNubOuter,
    leftNubShell,
    rightNubShell,
    d,
    face,
    selectHref,
    startHref,
    modeHref,
    leftStickDecal,
    rightStickDecal,
    leftStickPress,
    rightStickPress,
    leftTriggerHref,
    rightTriggerHref,
    leftBumperHref,
    rightBumperHref,
    geom: GEOM_DEFAULT,
    shellHref,
    iconGeom,
    tt: iconGeom.triggerTrack,
    svgViewBox,
    shoulderOn,
    bumperOn,
    shellPadX: SHELL_PAD_X,
    shellPadY: SHELL_PAD_Y,
    shellIconScale: SHELL_ICON_SCALE,
    triggerBarH: TRIGGER_BAR_H,
  };
}
