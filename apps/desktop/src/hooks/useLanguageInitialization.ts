import { useEffect } from "react";
import { useConfig } from "@hooks/useConfig";
import i18n from "i18next";
import { locale } from "@tauri-apps/plugin-os";

export function useLanguageInitialization() {
  const { config, loading } = useConfig();

  useEffect(() => {
    let active = true;

    const initLanguage = async () => {
      if (loading) return;

      if (config?.language) {
        if (active && i18n.language !== config.language) {
          await i18n.changeLanguage(config.language);
        }
        return;
      }

      try {
        const sysLocale = await locale();
        if (active && sysLocale) {
          const lang = sysLocale.split("-")[0].toLowerCase();
          if (lang === "en" || lang === "es") {
            if (i18n.language !== lang) {
              await i18n.changeLanguage(lang);
            }
          }
        }
      } catch (err) {
        console.warn("[SaveCloud:useLanguageInitialization] Error detectando locale del OS:", err);
      }
    };

    void initLanguage();

    return () => {
      active = false;
    };
  }, [config?.language, loading]);
}
