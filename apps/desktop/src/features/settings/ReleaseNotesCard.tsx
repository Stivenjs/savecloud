import { Button, Card, CardBody } from "@heroui/react";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ReleaseNotesCardProps {
  onOpenNotes: () => void;
}

export function ReleaseNotesCard({ onOpenNotes }: ReleaseNotesCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-center gap-2">
          <FileText size={20} className="text-default-500" />
          <h2 className="text-base font-semibold text-foreground">{t("settings.releaseNotes.title")}</h2>
        </div>
        <p className="text-sm text-default-500">{t("settings.releaseNotes.subtitle")}</p>
        <Button size="sm" variant="flat" onPress={onOpenNotes}>
          {t("settings.releaseNotes.viewButton")}
        </Button>
      </CardBody>
    </Card>
  );
}
