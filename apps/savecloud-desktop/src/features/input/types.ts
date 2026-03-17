export type SemanticAction =
  | "navigate_up"
  | "navigate_down"
  | "navigate_left"
  | "navigate_right"
  | "confirm"
  | "back"
  | "menu";

export interface ControllerEvent {
  action: SemanticAction;
  player: number;
}

export interface NodeNeighbors {
  up?: string;
  down?: string;
  left?: string;
  right?: string;
}

export interface FocusNode {
  id: string;
  ref: React.RefObject<HTMLElement | null>;
  scope?: string; // Para agrupar navegación (ej. 'sidebar', 'library_grid')
  neighbors?: NodeNeighbors;
  onSelect?: () => void;
  onFocus?: () => void;
}

export interface NavigationContextProps {
  activeId: string | null;
  activeScope: string;
  registerNode: (node: FocusNode) => void;
  unregisterNode: (id: string) => void;
  isFocusVisible: boolean;
  setActiveId: (id: string) => void;
  setScope: (scope: string) => void;
  handleAction: (action: SemanticAction) => void;
}
