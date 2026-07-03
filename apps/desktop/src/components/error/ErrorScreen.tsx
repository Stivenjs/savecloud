import { Button } from "@heroui/react";
import { useTranslation } from "react-i18next";

interface ErrorScreenProps {
  message?: string;
}

export function ErrorScreen({ message }: ErrorScreenProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">{t("errors.unexpected")}</h1>

      <p className="text-default-500">{t("errors.tryRestart")}</p>

      {import.meta.env.DEV && message && (
        <pre className="max-w-xl overflow-auto rounded-md bg-default-100 p-4 text-left text-xs text-red-500">
          {message}
        </pre>
      )}

      <Button color="primary" onPress={() => window.location.reload()}>
        {t("errors.reloadApp")}
      </Button>
    </div>
  );
}
