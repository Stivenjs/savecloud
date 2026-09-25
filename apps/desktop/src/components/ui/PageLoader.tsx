import { Spinner } from "@heroui/react";
import { useTranslation } from "react-i18next";

export function PageLoader() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[80vh] items-center justify-center">
      <Spinner size="lg" color="primary" label={t("common.loading")} />
    </div>
  );
}
