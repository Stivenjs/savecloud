import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { TitleBar } from "@components/layout/TitleBar";
import { SettingsPage } from "@features/settings/SettingsPage";
import { useProfileSessionHydration } from "@hooks/useProfileSession";
import { SAVECLOUD_SETTINGS_CHROME_EVENT, type SavecloudSettingsChromePayload } from "@/windows/settingsWindow";

function readInitialHideTitleBarFromSearch(): boolean {
  return new URLSearchParams(window.location.search).get("bpSettings") === "1";
}

export function SettingsWindowPage() {
  useProfileSessionHydration();
  const [hideTitleBar, setHideTitleBar] = useState(readInitialHideTitleBarFromSearch);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<SavecloudSettingsChromePayload>(SAVECLOUD_SETTINGS_CHROME_EVENT, (e) => {
      setHideTitleBar(!!e.payload?.hideTitleBar);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {!hideTitleBar ? <TitleBar /> : null}
      <div
        className={
          hideTitleBar ? "h-screen overflow-hidden px-3 pb-3 pt-3" : "h-screen overflow-hidden px-3 pb-3 pt-12"
        }>
        <SettingsPage compactWindowMode />
      </div>
    </div>
  );
}
