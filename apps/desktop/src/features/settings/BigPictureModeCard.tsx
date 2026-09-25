import { Button, Card, CardBody, Select, SelectItem } from "@heroui/react";
import { Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBigPictureMode } from "@/hooks/useBigPictureMode";

export function BigPictureModeCard() {
  const { t } = useTranslation();
  const { isDesktop, loading, saving, toggleBusy, startupMode, bigPictureActive, changeStartupMode, toggleNow } =
    useBigPictureMode();

  if (!isDesktop) {
    return null;
  }

  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-start gap-3">
          <Monitor size={20} className="mt-0.5 shrink-0 text-default-500" />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">{t("settings.bigPicture.title")}</h2>
              <p className="mt-0.5 text-sm text-default-500">{t("settings.bigPicture.desc")}</p>
              <p className="mt-1 text-xs text-default-400">{t("settings.bigPicture.helpText")}</p>
            </div>

            <Select
              label={t("settings.bigPicture.label")}
              selectedKeys={new Set([startupMode])}
              onSelectionChange={(keys) => {
                const raw = Array.from(keys)[0];
                const k = raw != null ? String(raw) : "";
                if (k === "normal" || k === "big_picture") void changeStartupMode(k);
              }}
              isDisabled={loading || saving}
              size="sm"
              variant="bordered"
              className="max-w-md"
              aria-label={t("settings.bigPicture.title")}>
              <SelectItem key="normal" textValue={t("settings.bigPicture.normalWindow")}>
                {t("settings.bigPicture.normalWindow")}
              </SelectItem>
              <SelectItem key="big_picture" textValue={t("settings.bigPicture.consoleWindow")}>
                {t("settings.bigPicture.consoleWindow")}
              </SelectItem>
            </Select>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                color="primary"
                variant="flat"
                isLoading={toggleBusy}
                onPress={() => void toggleNow()}
                aria-label={
                  bigPictureActive ? t("settings.bigPicture.backToNormal") : t("settings.bigPicture.enterNow")
                }>
                {bigPictureActive ? t("settings.bigPicture.backToNormal") : t("settings.bigPicture.enterNow")}
              </Button>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
