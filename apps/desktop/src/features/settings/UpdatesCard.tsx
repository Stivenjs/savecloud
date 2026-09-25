import { Button, Card, CardBody } from "@heroui/react";
import { Package } from "lucide-react";
import { useTranslation } from "react-i18next";

interface UpdatesCardProps {
  checkingUpdate: boolean;
  onCheckUpdates: () => void | Promise<void>;
}

export function UpdatesCard({ checkingUpdate, onCheckUpdates }: UpdatesCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-center gap-2">
          <Package size={20} className="text-default-500" />
          <h2 className="text-base font-semibold text-foreground">{t("settings.updatesCard.title")}</h2>
        </div>
        <p className="text-sm text-default-500">{t("settings.updatesCard.subtitle")}</p>
        <Button size="sm" variant="flat" onPress={onCheckUpdates} isLoading={checkingUpdate}>
          {t("settings.updatesCard.checkButton")}
        </Button>
      </CardBody>
    </Card>
  );
}
