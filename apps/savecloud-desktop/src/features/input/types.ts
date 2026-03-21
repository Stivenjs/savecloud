export type InputMode = "gamepad" | "mouse";
export type SemanticAction =
  | "navigate_up"
  | "navigate_down"
  | "navigate_left"
  | "navigate_right"
  | "confirm"
  | "back"
  | "menu";

export interface FocusNode {
  id: string;
  getElement: () => HTMLElement | null;
  onPress?: () => void;
}

export interface Layer {
  id: string;
  nodes: Map<string, FocusNode>;
  previousFocusId: string | null;
}
