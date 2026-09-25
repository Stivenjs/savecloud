import { Button, Input } from "@heroui/react";
import { Link2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface BigPictureShareLinkSectionProps {
  shareLinkInput: string;
  onShareLinkChange: (value: string) => void;
  onImportPress: () => void;
  loading: boolean;
  disabled: boolean;
}

/**
 * Sección de importar por link optimizada para Big Picture.
 *
 * Input y botón grandes, texto legible desde distancia de sofá,
 * sin Card wrapper (usa el fondo de la página directamente).
 */
export function BigPictureShareLinkSection({
  shareLinkInput,
  onShareLinkChange,
  onImportPress,
  loading,
  disabled,
}: BigPictureShareLinkSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-primary-500/20 bg-primary-500/6 px-6 py-6 sm:px-8 sm:py-7">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15">
            <Link2 size={22} className="text-primary" />
          </div>
          <h2 className="text-lg font-bold text-foreground md:text-xl">{t("friends.shareLinkCard.title")}</h2>
        </div>
        <p className="mb-5 text-sm text-default-400 md:text-base leading-relaxed max-w-2xl">
          {t("friends.shareLinkCard.descBp")}
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <Input
            label={t("friends.shareLinkCard.label")}
            placeholder={t("friends.shareLinkCard.placeholder")}
            value={shareLinkInput}
            onValueChange={onShareLinkChange}
            variant="bordered"
            size="lg"
            isClearable
            onClear={() => onShareLinkChange("")}
            onKeyDown={(e) => {
              if (e.key === "Enter") onImportPress();
            }}
            classNames={{
              base: "sm:max-w-lg",
              input: "text-base",
              label: "text-sm md:text-base",
            }}
          />
          <Button
            size="lg"
            variant="flat"
            color="primary"
            onPress={onImportPress}
            isLoading={loading}
            isDisabled={disabled}
            className="h-12 px-6 text-base font-semibold rounded-xl">
            {t("friends.shareLinkCard.button")}
          </Button>
        </div>
      </div>
    </div>
  );
}
