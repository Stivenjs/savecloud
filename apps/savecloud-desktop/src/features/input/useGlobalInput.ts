import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { init, setKeyMap, navigateByDirection } from "@noriginmedia/norigin-spatial-navigation";
import { ControllerEvent } from "@features/input/types";

init({
  debug: false,
  visualDebug: true,
});

setKeyMap({
  left: 37,
  up: 38,
  right: 39,
  down: 40,
  enter: 13,
});

export function useGlobalInput() {
  useEffect(() => {
    const unlistenPromise = listen<ControllerEvent>("controller_action", (event) => {
      const action = event.payload.action;

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
          const enterEvent = new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true });
          document.dispatchEvent(enterEvent);
          break;
        case "back":
          const escEvent = new KeyboardEvent("keydown", { key: "Escape", keyCode: 27, bubbles: true });
          document.dispatchEvent(escEvent);
          break;
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);
}
