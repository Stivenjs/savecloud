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
  /**
   * Dispara `onPress` del nodo espacial enfocado si existe (p. ej. clic «Seleccionar» en HUD Big Picture).
   * No exige modo mando ni actualiza modo de entrada.
   */
  confirmFocusedNodeFromHud: () => boolean;
}

const nodesByLayer = new Map<string, Map<string, FocusNode>>();

export const useNavigationStore = create<NavigationState>((set, get) => ({
  inputMode: "mouse",
  setInputMode: (mode) => set({ inputMode: mode }),

  layers: [{ id: "root", nodes: new Map(), previousFocusId: null }],
  focusedId: null,

  pushLayer: (layerId, initialFocusId: string | null = null) => {
    set((state) => {
      if (state.layers.some((l) => l.id === layerId)) return state;
      const existing = nodesByLayer.get(layerId);
      const layerNodes = new Map(existing ? Array.from(existing.entries()) : []);
      const activeFocus = initialFocusId ?? (layerNodes.size > 0 ? Array.from(layerNodes.keys())[0] : null);
      return {
        layers: [...state.layers, { id: layerId, nodes: layerNodes, previousFocusId: state.focusedId }],
        focusedId: activeFocus,
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
    let layerMap = nodesByLayer.get(layerId);
    if (!layerMap) {
      layerMap = new Map();
      nodesByLayer.set(layerId, layerMap);
    }
    layerMap.set(node.id, node);

    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer) layer.nodes.set(node.id, node);

      const activeLayer = state.layers[state.layers.length - 1];
      if (
        state.inputMode === "gamepad" &&
        !state.focusedId &&
        activeLayer?.id === layerId &&
        (layer?.nodes.size === 1 || activeLayer?.nodes.size === 1)
      ) {
        return { focusedId: node.id };
      }
      return state;
    });
  },

  unregisterNode: (layerId, nodeId) => {
    const layerMap = nodesByLayer.get(layerId);
    if (layerMap) layerMap.delete(nodeId);

    set((state) => {
      const layer = state.layers.find((l) => l.id === layerId);
      if (layer) layer.nodes.delete(nodeId);
      return state;
    });
  },

  setFocus: (id) => {
    set((state) => {
      const activeLayer = state.layers[state.layers.length - 1];
      const targetNode = activeLayer.nodes.get(id);

      if (state.inputMode === "gamepad") {
        const element = targetNode?.getElement();
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        playSound(Sounds.navigate);
      }

      return { focusedId: id };
    });
  },

  navigate: (direction) => {
    const { layers, focusedId, setFocus, inputMode } = get();
    if (inputMode !== "gamepad") return;

    const activeLayer = layers[layers.length - 1];
    if (activeLayer.nodes.size === 0) return;

    if (!focusedId || !activeLayer.nodes.has(focusedId)) {
      const allKeys = Array.from(activeLayer.nodes.keys());
      const firstGameKey = allKeys.find((k) => k.startsWith("game-card-"));
      const firstNodeId = firstGameKey ?? allKeys[0];
      setFocus(firstNodeId);
      return;
    }

    const currentNode = activeLayer.nodes.get(focusedId);
    let currentElement = currentNode?.getElement();
    if (!currentElement) {
      for (const node of activeLayer.nodes.values()) {
        const el = node.getElement();
        if (el) {
          setFocus(node.id);
          return;
        }
      }
      return;
    }

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

  confirmFocusedNodeFromHud: () => {
    const { layers, focusedId } = get();
    if (!focusedId) return false;

    const activeLayer = layers[layers.length - 1];
    const node = activeLayer.nodes.get(focusedId);

    if (node?.onPress) {
      playSound(Sounds.confirm);
      node.onPress();
      return true;
    }
    return false;
  },
}));
