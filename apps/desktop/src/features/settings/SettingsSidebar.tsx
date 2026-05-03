import { Button } from "@heroui/react";
import type { ReactNode } from "react";

export type SettingsTabKey = "account" | "app" | "big-picture" | "integrations" | "gamepad" | "updates" | "advanced";

interface SettingsTabItem {
  key: SettingsTabKey;
  label: string;
  icon: ReactNode;
}

interface SettingsSidebarProps {
  tabs: SettingsTabItem[];
  selectedTab: SettingsTabKey;
  onSelectTab: (tab: SettingsTabKey) => void;
}

export function SettingsSidebar({ tabs, selectedTab, onSelectTab }: SettingsSidebarProps) {
  return (
    <aside className="h-full min-h-0 overflow-y-auto rounded-xl border border-default-200/80 bg-default-50/35 p-3">
      <div className="pb-3">
        <div className="rounded-lg bg-default-100/50 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-default-500">Ajustes</p>
          <p className="mt-1 text-xs text-default-500">Cuenta, app, Big Picture, mandos e integraciones</p>
        </div>
      </div>
      <div className="space-y-1">
        {tabs.map((tab) => {
          const selected = selectedTab === tab.key;
          return (
            <Button
              key={tab.key}
              fullWidth
              variant={selected ? "flat" : "light"}
              color={selected ? "primary" : "default"}
              className="h-10 justify-start"
              onPress={() => onSelectTab(tab.key)}
              startContent={tab.icon}>
              {tab.label}
            </Button>
          );
        })}
      </div>
    </aside>
  );
}
