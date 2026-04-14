import { create } from "zustand";
import { FocusNode, InputMode, Layer } from "@features/input/types";
import { findNextNode } from "@features/input/spatialLogic";
import { playSound, Sounds } from "@features/input/sounds";

interface NavigationState {
  inputMode: InputMode;
  setInputMode: (mode: InputMode) => void;

  layers: Layer[];
  focusedId: string | null;

  pushLayer: (layerId: string, initialFocusId?: string) => void;
  popLayer: () => void;

  registerNode: (layerId: string, node: FocusNode) => void;
  unregisterNode: (layerId: string, nodeId: string) => void;

  setFocus: (id: string) => void;
  navigate: (direction: "UP" | "DOWN" | "LEFT" | "RIGHT") => void;
  confirm: () => void;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  inputMode: "mouse",
  setInputMode: (mode) => set({ inputMode: mode }),

  layers: [{ id: "root", nodes: new Map(), previousFocusId: null }],
  focusedId: null,

  pushLayer: (layerId, initialFocusId: string | null = null) => {
    set((state) => {
      if (state.layers.some((l) => l.id === layerId)) return state;
      return {
        layers: [...state.layers, { id: layerId, nodes: new Map(), previousFocusId: state.focusedId }],
        focusedId: initialFocusId,
      };
    });
  },

  popLayer: () => {
    set((state) => {
      if (state.layers.length <= 1) return state;
      const newLayers = [...state.layers];
      const popped = newLayers.pop();

      if (state.inputMode === "gamepad") playSound(Sounds.back);

      if (popped?.previousFocusId && state.inputMode === "gamepad") {
        const previousLayer = newLayers[newLayers.length - 1];
        const previousNode = previousLayer?.nodes.get(popped.previousFocusId);
        const element = previousNode?.getElement();
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }

      return {
        layers: newLayers,
        focusedId: popped?.previousFocusId || null,
      };
    });
  },

  registerNode: (layerId, node) => {
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer) layer.nodes.set(node.id, node);

      if (state.inputMode === "gamepad" && !state.focusedId && layerId === "root" && layer?.nodes.size === 1) {
        return { focusedId: node.id };
      }
      return state;
    });
  },

  unregisterNode: (layerId, nodeId) => {
    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer) layer.nodes.delete(nodeId);
      return state;
    });
  },

  setFocus: (id) => {
    set((state) => {
      if (state.inputMode !== "gamepad") return state;

      const activeLayer = state.layers[state.layers.length - 1];
      const targetNode = activeLayer.nodes.get(id);

      const element = targetNode?.getElement();
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }

      playSound(Sounds.navigate);

      return { focusedId: id };
    });
  },

  navigate: (direction) => {
    const { layers, focusedId, setFocus, inputMode } = get();
    if (inputMode !== "gamepad") return;

    const activeLayer = layers[layers.length - 1];
    if (activeLayer.nodes.size === 0) return;

    if (!focusedId || !activeLayer.nodes.has(focusedId)) {
      const firstNodeId = Array.from(activeLayer.nodes.keys())[0];
      setFocus(firstNodeId);
      return;
    }

    const currentNode = activeLayer.nodes.get(focusedId);
    const currentElement = currentNode?.getElement();
    if (!currentElement) return;

    const nextNodeId = findNextNode(currentElement, Array.from(activeLayer.nodes.values()), direction);
    if (nextNodeId) setFocus(nextNodeId);
  },

  confirm: () => {
    const { layers, focusedId, inputMode } = get();
    if (inputMode !== "gamepad" || !focusedId) return;

    const activeLayer = layers[layers.length - 1];
    const node = activeLayer.nodes.get(focusedId);

    if (node && node.onPress) {
      playSound(Sounds.confirm);
      node.onPress();
    }
  },
}));
