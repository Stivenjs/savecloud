import { Button, Card, CardBody, Input } from "@heroui/react";
import { Link2 } from "lucide-react";
import { useTranslation, Trans } from "react-i18next";

interface ShareLinkCardProps {
  shareLinkInput: string;
  onShareLinkChange: (value: string) => void;
  onImportPress: () => void;
  loading: boolean;
  disabled: boolean;
}

export function ShareLinkCard({
  shareLinkInput,
  onShareLinkChange,
  onImportPress,
  loading,
  disabled,
}: ShareLinkCardProps) {
  const { t } = useTranslation();

  return (
    <Card className="border border-primary-200/50 bg-primary-50/30 dark:border-primary-500/20 dark:bg-primary-500/5">
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Link2 size={20} className="text-primary" />
          <h2 className="text-base font-semibold text-foreground">{t("friends.shareLinkCard.title")}</h2>
        </div>
        <p className="text-sm text-default-600">
          <Trans i18nKey="friends.shareLinkCard.desc">
            Si alguien te envió un <strong>link para compartir</strong> (desde el menú ⋮ del juego → &quot;Compartir por
            link&quot;), pégalo aquí. Verás qué archivos se copiarán y podrás confirmar antes de importar a tu nube.
          </Trans>
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input
            label={t("friends.shareLinkCard.label")}
            placeholder={t("friends.shareLinkCard.placeholder")}
            value={shareLinkInput}
            onValueChange={onShareLinkChange}
            variant="bordered"
            className="sm:max-w-md"
            isClearable
            onClear={() => onShareLinkChange("")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onImportPress();
              }
            }}
          />
          <Button variant="flat" color="primary" onPress={onImportPress} isLoading={loading} isDisabled={disabled}>
            {t("friends.shareLinkCard.button")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
