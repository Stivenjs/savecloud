import { useEffect } from "react";
import { useNavigationStore } from "@features/input/store";

export function useNavigable({
  id,
  layerId = "root",
  onPress,
}: {
  id: string;
  layerId?: string;
  onPress?: () => void;
}) {
  const registerNode = useNavigationStore((state) => state.registerNode);
  const unregisterNode = useNavigationStore((state) => state.unregisterNode);
  const focusedId = useNavigationStore((state) => state.focusedId);
  const inputMode = useNavigationStore((state) => state.inputMode);
  const setFocus = useNavigationStore((state) => state.setFocus);

  useEffect(() => {
    registerNode(layerId, {
      id,
      getElement: () => document.querySelector(`[data-nav-id="${id}"]`) as HTMLElement | null,
      onPress,
    });

    return () => unregisterNode(layerId, id);
  }, [id, layerId, registerNode, unregisterNode, onPress]);

  return {
    isFocused: focusedId === id,
    inputMode,
    navProps: {
      "data-nav-id": id,
      onMouseEnter: () => setFocus(id),
    },
  };
}
