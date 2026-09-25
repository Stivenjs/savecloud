import { useCallback, useTransition } from "react";
import { Card, CardBody, Select, SelectItem } from "@heroui/react";
import { Languages } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { CONFIG_QUERY_KEY, useConfig } from "@hooks/useConfig";
import { setLanguage } from "@services/tauri";
import { toastError, toastSuccess } from "@utils/toast";

export function LanguageSettingsCard() {
  const { t, i18n } = useTranslation();
  const { config, loading, refetch } = useConfig();
  const qc = useQueryClient();
  const [pending, startTransition] = useTransition();

  const currentLanguage = config?.language || "";

  const onChange = useCallback(
    (key: string) => {
      const value = key === "auto" ? null : key;
      startTransition(async () => {
        try {
          await setLanguage(value);
          void qc.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
          await refetch();

          if (value) {
            await i18n.changeLanguage(value);
          } else {
            const { locale } = await import("@tauri-apps/plugin-os");
            const sysLocale = await locale();
            if (sysLocale) {
              const lang = sysLocale.split("-")[0].toLowerCase();
              await i18n.changeLanguage(lang === "en" || lang === "es" ? lang : "es");
            }
          }
          toastSuccess(t("common.success"));
        } catch (e) {
          toastError((e instanceof Error ? e.message : String(e)) || "Error al cambiar el idioma");
        }
      });
    },
    [qc, refetch, i18n, t]
  );

  const selectedKey = currentLanguage || "auto";

  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Languages size={20} className="mt-0.5 shrink-0 text-default-500" />
            <div>
              <h2 className="text-base font-semibold text-foreground">{t("settings.language.title")}</h2>
              <p className="mt-0.5 text-sm text-default-500">{t("settings.language.subtitle")}</p>
            </div>
          </div>
          <Select
            aria-label={t("settings.language.title")}
            selectedKeys={[selectedKey]}
            isDisabled={loading || pending}
            onChange={(e) => onChange(e.target.value)}
            className="w-full sm:max-w-[200px]"
            disallowEmptySelection
            size="sm">
            <SelectItem key="auto" textValue={t("settings.language.auto")}>
              {t("settings.language.auto")}
            </SelectItem>
            <SelectItem key="es" textValue={t("settings.language.es")}>
              {t("settings.language.es")}
            </SelectItem>
            <SelectItem key="en" textValue={t("settings.language.en")}>
              {t("settings.language.en")}
            </SelectItem>
          </Select>
        </div>
      </CardBody>
    </Card>
  );
}
