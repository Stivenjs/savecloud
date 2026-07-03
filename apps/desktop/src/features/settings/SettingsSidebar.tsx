import type { ReactNode } from "react";
import { SETTINGS_SIDEBAR_SECTIONS } from "@/constants/settingsSidebarSections";
import { SettingsSidebarVersionFooter } from "@/features/settings/SettingsSidebarVersionFooter";
import { useTranslation } from "react-i18next";

export type SettingsTabKey =
  | "account"
  | "cloud"
  | "app"
  | "big-picture"
  | "integrations"
  | "gamepad"
  | "updates"
  | "advanced";

export interface SettingsTabItem {
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
  const byKey = new Map(tabs.map((t) => [t.key, t]));
  const { t } = useTranslation();

  const getSectionTitle = (title: string) => {
    switch (title) {
      case "Cuenta y datos":
        return t("settings.sections.account");
      case "Aplicación":
        return t("settings.sections.app");
      case "Dispositivos e integraciones":
        return t("settings.sections.integrations");
      case "Sistema":
        return t("settings.sections.system");
      default:
        return title;
    }
  };

  const getTabLabel = (key: string, defaultLabel: string) => {
    switch (key) {
      case "account":
        return t("settings.tabs.account");
      case "cloud":
        return t("settings.tabs.cloud");
      case "app":
        return t("settings.tabs.app");
      case "big-picture":
        return t("settings.tabs.bigPicture");
      case "integrations":
        return t("settings.tabs.integrations");
      case "gamepad":
        return t("settings.tabs.gamepad");
      case "updates":
        return t("settings.tabs.updates");
      case "advanced":
        return t("settings.tabs.advanced");
      default:
        return defaultLabel;
    }
  };

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-default-200/70 bg-linear-to-b from-default-100/50 to-default-50/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] dark:border-default-100/20 dark:from-default-50/25 dark:to-default-100/10">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3">
        <header className="border-b border-default-200/60 px-1 pb-3 dark:border-default-100/15">
          <p className="text-[11px] font-bold uppercase leading-tight tracking-[0.14em] text-primary">
            {t("settings.title")}
          </p>
          <p className="mt-1.5 text-[11px] leading-snug text-default-500">{t("settings.subtitle")}</p>
        </header>

        <nav className="mt-3 space-y-0" aria-label="Secciones de configuración">
          {SETTINGS_SIDEBAR_SECTIONS.map((section, sectionIndex) => (
            <div key={section.title}>
              {sectionIndex > 0 ? (
                <div className="my-3 h-px bg-default-200/55 dark:bg-default-100/12" aria-hidden role="separator" />
              ) : null}
              <div className="px-1">
                <h2 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-default-400">
                  {getSectionTitle(section.title)}
                </h2>
                <ul className="space-y-0.5">
                  {section.tabKeys.map((key) => {
                    const tab = byKey.get(key);
                    if (!tab) return null;
                    const selected = selectedTab === tab.key;
                    return (
                      <li key={tab.key}>
                        <button
                          type="button"
                          onClick={() => onSelectTab(tab.key)}
                          className={[
                            "flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md border-l-2 py-2 pr-2 pl-[calc(0.5rem-2px)] text-left text-[13px] transition-[background-color,color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                            selected
                              ? "border-primary bg-primary/12 font-medium text-primary"
                              : "border-transparent text-default-600 hover:bg-default-100/90 hover:text-foreground dark:hover:bg-default-100/25",
                          ].join(" ")}
                          aria-current={selected ? "page" : undefined}>
                          <span
                            className={[
                              "flex size-7 shrink-0 items-center justify-center rounded-md border border-transparent bg-default-100/55 dark:bg-default-100/15",
                              selected ? "border-primary/25 bg-primary/10 text-primary" : "text-default-500",
                            ].join(" ")}>
                            {tab.icon}
                          </span>
                          <span className="min-w-0 truncate">{getTabLabel(tab.key, tab.label)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ))}
        </nav>
      </div>
      <SettingsSidebarVersionFooter onGoToUpdates={() => onSelectTab("updates")} />
    </aside>
  );
}
