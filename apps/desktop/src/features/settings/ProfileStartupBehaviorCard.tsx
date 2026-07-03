import { Card, CardBody, Switch } from "@heroui/react";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ProfileStartupBehaviorCardProps {
  alwaysShowProfileSelector: boolean;
  loading: boolean;
  onChange: (checked: boolean) => void;
}

export function ProfileStartupBehaviorCard({
  alwaysShowProfileSelector,
  loading,
  onChange,
}: ProfileStartupBehaviorCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Users size={20} className="mt-0.5 shrink-0 text-default-500" />
            <div>
              <h2 className="text-base font-semibold text-foreground">{t("settings.startupBehavior.title")}</h2>
              <p className="mt-0.5 text-sm text-default-500">{t("settings.startupBehavior.subtitle")}</p>
            </div>
          </div>
          <Switch isSelected={alwaysShowProfileSelector} onValueChange={onChange} isDisabled={loading} />
        </div>
      </CardBody>
    </Card>
  );
}
