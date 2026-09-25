import { Card, CardBody, Switch } from "@heroui/react";
import { Power } from "lucide-react";
import { useTranslation } from "react-i18next";

interface AutostartCardProps {
  autostart: boolean;
  loading: boolean;
  onChange: (checked: boolean) => void;
}

export function AutostartCard({ autostart, loading, onChange }: AutostartCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Power size={20} className="mt-0.5 shrink-0 text-default-500" />
            <div>
              <h2 className="text-base font-semibold text-foreground">{t("settings.autostart.title")}</h2>
              <p className="mt-0.5 text-sm text-default-500">{t("settings.autostart.subtitle")}</p>
            </div>
          </div>
          <Switch
            isSelected={autostart}
            onValueChange={onChange}
            isDisabled={loading}
            aria-label={t("settings.autostart.ariaLabel")}
          />
        </div>
      </CardBody>
    </Card>
  );
}
