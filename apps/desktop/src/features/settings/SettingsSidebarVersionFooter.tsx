import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getName, getTauriVersion, getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
import i18n from "@lib/i18n";

function webEngineLabel(): string {
  if (typeof navigator === "undefined") return i18n.t("settings.sidebarFooter.webEngine", "Motor web");
  const ua = navigator.userAgent;
  const edg = ua.match(/Edg\/([\d.]+)/);
  if (edg) return `WebView Edge ${edg[1]}`;
  const chrome = ua.match(/Chrome\/([\d.]+)/);
  if (chrome) return `Chromium ${chrome[1]}`;
  if (ua.includes("Safari") && !ua.includes("Chrome")) {
    const m = ua.match(/Version\/([\d.]+)/);
    if (m) return `WebKit ${m[1]}`;
  }
  return i18n.t("settings.sidebarFooter.integratedWebEngine", "Motor web integrado");
}

function commitSuffix(): string {
  const sha = __SAVECLOUD_GIT_SHORT_SHA__;
  return sha ? ` (${sha})` : "";
}

interface SettingsSidebarVersionFooterProps {
  onGoToUpdates: () => void;
}

export function SettingsSidebarVersionFooter({ onGoToUpdates }: SettingsSidebarVersionFooterProps) {
  const { t } = useTranslation();
  const [textLines, setTextLines] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const channel = import.meta.env.DEV ? "dev" : "stable";
    const fallbackVersion = __SAVECLOUD_APP_VERSION__;

    void (async () => {
      if (!isTauri()) {
        const lines = [
          `${channel} v${fallbackVersion}${commitSuffix()}`,
          `SaveCloud v${fallbackVersion}`,
          "Tauri —",
          webEngineLabel(),
        ];
        if (!cancelled) setTextLines(lines);
        return;
      }

      try {
        const [version, tauriVersion, name] = await Promise.all([getVersion(), getTauriVersion(), getName()]);
        const lines = [
          `${channel} v${version}${commitSuffix()}`,
          `${name} v${version}`,
          `Tauri ${tauriVersion}`,
          webEngineLabel(),
        ];
        if (!cancelled) setTextLines(lines);
      } catch {
        const lines = [
          `${channel} v${fallbackVersion}${commitSuffix()}`,
          `SaveCloud v${fallbackVersion}`,
          "Tauri —",
          webEngineLabel(),
        ];
        if (!cancelled) setTextLines(lines);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <footer className="shrink-0 border-t border-default-200/55 bg-default-100/25 px-2.5 py-2.5 dark:border-default-100/12 dark:bg-default-100/10">
      <div className="select-text text-[10px] leading-[1.35] text-default-400">
        {textLines.map((line, i) => (
          <p key={i} className="wrap-break-word">
            {line}
          </p>
        ))}
      </div>
      <button
        type="button"
        onClick={onGoToUpdates}
        className="mt-1.5 cursor-pointer rounded-sm text-left text-[10px] text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-1 focus-visible:ring-offset-background">
        {t("settings.sidebarFooter.checkUpdates")}
      </button>
    </footer>
  );
}
