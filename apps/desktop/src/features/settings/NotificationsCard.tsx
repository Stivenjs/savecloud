import { Button, Card, CardBody } from "@heroui/react";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";

interface NotificationsCardProps {
  testingNotification: boolean;
  onTestNotification: () => void | Promise<void>;
}

export function NotificationsCard({ testingNotification, onTestNotification }: NotificationsCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-center gap-2">
          <Bell size={20} className="text-default-500" />
          <h2 className="text-base font-semibold text-foreground">{t("settings.notifications.title")}</h2>
        </div>
        <p className="text-sm text-default-500">{t("settings.notifications.subtitle")}</p>
        <Button size="sm" variant="flat" onPress={onTestNotification} isLoading={testingNotification}>
          {t("settings.notifications.testButton")}
        </Button>
      </CardBody>
    </Card>
  );
}
