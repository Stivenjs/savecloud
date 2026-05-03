import type { GamepadLayoutKind } from "@/lib/gamepadLabelMaps";

type KenneyPack = "xbox" | "playstation" | "nintendo";

function kenneyPack(layoutKind: GamepadLayoutKind): KenneyPack {
  if (layoutKind === "playstation") return "playstation";
  if (layoutKind === "nintendo") return "nintendo";
  return "xbox";
}

/** Solo SVG usados por el diagrama de mando; el resto del pack Kenney no se empaqueta. */
const xboxVectors = import.meta.glob(
  [
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/controller_xboxone.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_button_color_a.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_button_color_b.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_button_color_x.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_button_color_y.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_dpad_down.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_dpad_left.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_dpad_right.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_dpad_up.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_button_view.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_button_menu.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_guide.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_stick_l.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_stick_r.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_stick_l_press.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_stick_r_press.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_lt.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_rt.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_lb.svg",
    "../assets/kenney_input-prompts_1.4.1/Xbox Series/Vector/xbox_rb.svg",
  ],
  {
    eager: true,
    query: "?url",
    import: "default",
  }
) as Record<string, string>;

const playstationVectors = import.meta.glob(
  [
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/controller_playstation5.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation_button_color_circle.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation_button_color_cross.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation_button_color_square.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation_button_color_triangle.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation_dpad_down.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation_dpad_left.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation_dpad_right.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation_dpad_up.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation4_button_share.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation5_button_options.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation5_touchpad_press_center.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation_stick_l.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation_stick_r.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation_stick_l_press.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation_stick_r_press.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation_trigger_l1.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation_trigger_l2.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation_trigger_r1.svg",
    "../assets/kenney_input-prompts_1.4.1/PlayStation Series/Vector/playstation_trigger_r2.svg",
  ],
  {
    eager: true,
    query: "?url",
    import: "default",
  }
) as Record<string, string>;

const nintendoVectors = import.meta.glob(
  [
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/controller_switch_pro.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_button_a.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_button_b.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_button_x.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_button_y.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_dpad_down.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_dpad_left.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_dpad_right.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_dpad_up.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_button_minus.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_button_plus.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_button_home.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_stick_l.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_stick_r.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_stick_l_press.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_stick_r_press.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_button_zl.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_button_zr.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_button_l.svg",
    "../assets/kenney_input-prompts_1.4.1/Nintendo Switch/Vector/switch_button_r.svg",
  ],
  {
    eager: true,
    query: "?url",
    import: "default",
  }
) as Record<string, string>;

function basenameFromGlobKey(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const seg = norm.split("/").pop();
  if (!seg?.endsWith(".svg")) return "";
  return seg.slice(0, -4);
}

function buildLookup(glob: Record<string, string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [path, url] of Object.entries(glob)) {
    const base = basenameFromGlobKey(path);
    if (base) m.set(base, url);
  }
  return m;
}

const lookups: Record<KenneyPack, Map<string, string>> = {
  xbox: buildLookup(xboxVectors),
  playstation: buildLookup(playstationVectors),
  nintendo: buildLookup(nintendoVectors),
};

/** Perfil de silueta 64×64 (genérico usa el mismo layout que Xbox). */
export type KenneyChassisProfile = "xbox" | "playstation" | "nintendo";

export function kenneyChassisProfile(layoutKind: GamepadLayoutKind): KenneyChassisProfile {
  if (layoutKind === "playstation") return "playstation";
  if (layoutKind === "nintendo") return "nintendo";
  return "xbox";
}

/** Nombre base del SVG `controller_*.svg` en cada carpeta Kenney. */
export function kenneyControllerChassisAssetId(layoutKind: GamepadLayoutKind): string {
  switch (layoutKind) {
    case "playstation":
      return "controller_playstation5";
    case "nintendo":
      return "controller_switch_pro";
    default:
      return "controller_xboxone";
  }
}

/** URL resuelta por Vite (`?url`) para un recurso Kenney del pack que corresponde al perfil del mando. */
export function getKenneyGamepadAssetUrl(layoutKind: GamepadLayoutKind, assetBaseName: string): string | undefined {
  return lookups[kenneyPack(layoutKind)].get(assetBaseName);
}

export function getKenneyControllerChassisUrl(layoutKind: GamepadLayoutKind): string | undefined {
  return getKenneyGamepadAssetUrl(layoutKind, kenneyControllerChassisAssetId(layoutKind));
}

export type FaceButtonKey = "South" | "East" | "North" | "West";

export function kenneyFaceAssetId(layoutKind: GamepadLayoutKind, face: FaceButtonKey): string {
  const p = kenneyPack(layoutKind);
  if (p === "xbox") {
    const m: Record<FaceButtonKey, string> = {
      South: "xbox_button_color_a",
      East: "xbox_button_color_b",
      North: "xbox_button_color_y",
      West: "xbox_button_color_x",
    };
    return m[face];
  }
  if (p === "playstation") {
    const m: Record<FaceButtonKey, string> = {
      South: "playstation_button_color_cross",
      East: "playstation_button_color_circle",
      North: "playstation_button_color_triangle",
      West: "playstation_button_color_square",
    };
    return m[face];
  }
  const m: Record<FaceButtonKey, string> = {
    South: "switch_button_b",
    East: "switch_button_a",
    North: "switch_button_x",
    West: "switch_button_y",
  };
  return m[face];
}

export type DpadDir = "up" | "down" | "left" | "right";

export function kenneyDpadAssetId(layoutKind: GamepadLayoutKind, dir: DpadDir): string {
  const p = kenneyPack(layoutKind);
  if (p === "xbox") return `xbox_dpad_${dir}`;
  if (p === "playstation") return `playstation_dpad_${dir}`;
  return `switch_dpad_${dir}`;
}

export function kenneySelectAssetId(layoutKind: GamepadLayoutKind): string {
  const p = kenneyPack(layoutKind);
  if (p === "xbox") return "xbox_button_view";
  if (p === "playstation") return "playstation4_button_share";
  return "switch_button_minus";
}

export function kenneyStartAssetId(layoutKind: GamepadLayoutKind): string {
  const p = kenneyPack(layoutKind);
  if (p === "xbox") return "xbox_button_menu";
  if (p === "playstation") return "playstation5_button_options";
  return "switch_button_plus";
}

/** Botón central / sistema: en PS no hay icono «home» en el pack; usamos toque central del touchpad como aproximación visual. */
export function kenneyModeAssetId(layoutKind: GamepadLayoutKind): string {
  const p = kenneyPack(layoutKind);
  if (p === "xbox") return "xbox_guide";
  if (p === "playstation") return "playstation5_touchpad_press_center";
  return "switch_button_home";
}

export function kenneyStickBaseAssetId(layoutKind: GamepadLayoutKind, side: "left" | "right"): string {
  const p = kenneyPack(layoutKind);
  const lr = side === "left" ? "l" : "r";
  if (p === "xbox") return `xbox_stick_${lr}`;
  if (p === "playstation") return `playstation_stick_${lr}`;
  return `switch_stick_${lr}`;
}

export function kenneyStickPressAssetId(layoutKind: GamepadLayoutKind, side: "left" | "right"): string {
  const p = kenneyPack(layoutKind);
  const lr = side === "left" ? "l" : "r";
  if (p === "xbox") return `xbox_stick_${lr}_press`;
  if (p === "playstation") return `playstation_stick_${lr}_press`;
  return `switch_stick_${lr}_press`;
}

/** Gatillos analógicos (LT/RT, L2/R2, ZL/ZR) para HUD del diagrama. */
export type AnalogTriggerSide = "left" | "right";

export function kenneyAnalogTriggerAssetId(layoutKind: GamepadLayoutKind, side: AnalogTriggerSide): string {
  const p = kenneyPack(layoutKind);
  if (p === "xbox") return side === "left" ? "xbox_lt" : "xbox_rt";
  if (p === "playstation") return side === "left" ? "playstation_trigger_l2" : "playstation_trigger_r2";
  return side === "left" ? "switch_button_zl" : "switch_button_zr";
}

/** Hombreras / bumpers (LB/RB, L1/R1, L/R en Pro). */
export type BumperSide = "left" | "right";

export function kenneyBumperAssetId(layoutKind: GamepadLayoutKind, side: BumperSide): string {
  const p = kenneyPack(layoutKind);
  if (p === "xbox") return side === "left" ? "xbox_lb" : "xbox_rb";
  if (p === "playstation") return side === "left" ? "playstation_trigger_l1" : "playstation_trigger_r1";
  return side === "left" ? "switch_button_l" : "switch_button_r";
}
