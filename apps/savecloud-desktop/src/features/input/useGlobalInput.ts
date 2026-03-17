import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { init, setKeyMap, navigateByDirection } from "@noriginmedia/norigin-spatial-navigation";
import { ControllerEvent } from "./types";

init({
  debug: false,
  visualDebug: false,
});

setKeyMap({
  left: 37,
  up: 38,
  right: 39,
  down: 40,
  enter: 13,
});

export let isSpatialInputPaused = false;
export const setSpatialInputPaused = (paused: boolean) => {
  isSpatialInputPaused = paused;
};

export function useGlobalInput() {
  useEffect(() => {
    const unlistenPromise = listen<ControllerEvent>("controller_action", (event) => {
      const action = event.payload.action;

      const fireNativeKey = (key: string) => {
        const activeEl = document.activeElement || document.body;
        activeEl.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }));
      };

      if (isSpatialInputPaused) {
        switch (action) {
          case "navigate_up":
            fireNativeKey("ArrowUp");
            break;
          case "navigate_down":
            fireNativeKey("ArrowDown");
            break;
          case "navigate_left":
            fireNativeKey("ArrowLeft");
            break;
          case "navigate_right":
            fireNativeKey("ArrowRight");
            break;
          case "confirm":
            fireNativeKey("Enter");
            break;
          case "back":
            fireNativeKey("Escape");
            break;
        }
        return;
      }

      const dummyEvent = new KeyboardEvent("keydown", { bubbles: true });
      const focusDetails = { event: dummyEvent };

      switch (action) {
        case "navigate_up":
          navigateByDirection("up", focusDetails);
          break;
        case "navigate_down":
          navigateByDirection("down", focusDetails);
          break;
        case "navigate_left":
          navigateByDirection("left", focusDetails);
          break;
        case "navigate_right":
          navigateByDirection("right", focusDetails);
          break;
        case "confirm":
          fireNativeKey("Enter");
          break;
        case "back":
          fireNativeKey("Escape");
          break;
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}
