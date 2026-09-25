import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { TitleBar } from "@components/layout/TitleBar";
import { SettingsPage } from "@features/settings/SettingsPage";
import { useProfileSessionHydration } from "@hooks/useProfileSession";
import { useLanguageInitialization } from "@hooks/useLanguageInitialization";
import { parseSettingsTabQueryValue } from "@/constants/savecloudCrossWindow";
import type { SettingsTabKey } from "@features/settings/SettingsSidebar";
import { SAVECLOUD_SETTINGS_CHROME_EVENT, type SavecloudSettingsChromePayload } from "@/windows/settingsWindow";
import { useTranslation } from "react-i18next";

function readInitialHideTitleBarFromSearch(): boolean {
  return new URLSearchParams(window.location.search).get("bpSettings") === "1";
}

function readInitialSettingsTabFromSearch(): SettingsTabKey | null {
  const q = new URLSearchParams(window.location.search);
  return parseSettingsTabQueryValue(q.get("tab") ?? q.get("settingsTab"));
}

export function SettingsWindowPage() {
  useProfileSessionHydration();
  useLanguageInitialization();
  const { t } = useTranslation();
  const [hideTitleBar, setHideTitleBar] = useState(readInitialHideTitleBarFromSearch);
  const [initialSelectedTab] = useState<SettingsTabKey | null>(() => readInitialSettingsTabFromSearch());

  useEffect(() => {
    void getCurrentWindow().setTitle(t("nav.settings"));
  }, [t]);

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
        <SettingsPage compactWindowMode initialSelectedTab={initialSelectedTab} />
      </div>
    </div>
  );
}
