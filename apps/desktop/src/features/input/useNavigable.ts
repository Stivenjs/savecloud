import { useEffect, useRef } from "react";
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
  const setFocus = useNavigationStore((state) => state.setFocus);

  const isFocused = useNavigationStore((state) => state.focusedId === id);
  const inputMode = useNavigationStore((state) => state.inputMode);

  const onPressRef = useRef(onPress);
  useEffect(() => {
    onPressRef.current = onPress;
  }, [onPress]);

  useEffect(() => {
    registerNode(layerId, {
      id,
      getElement: () => document.querySelector(`[data-nav-id="${id}"]`) as HTMLElement | null,
      onPress: () => {
        if (onPressRef.current) {
          onPressRef.current();
        }
      },
    });

    return () => unregisterNode(layerId, id);
  }, [id, layerId, registerNode, unregisterNode]);

  return {
    isFocused,
    inputMode,
    navProps: {
      "data-nav-id": id,
      onMouseEnter: () => setFocus(id),
    },
  };
}
