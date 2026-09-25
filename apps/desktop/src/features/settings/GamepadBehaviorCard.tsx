/**
 * @file GamepadBehaviorCard.tsx
 * @description Tarjeta de configuración para ignorar comandos de mando cuando la ventana pierde el foco.
 * Construida con HeroUI y TanStack Query siguiendo vercel-react-best-practices.
 */

import { Card, CardBody, Switch } from "@heroui/react";
import { EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGamepadSettings } from "@hooks/useGamepadSettings";

export function GamepadBehaviorCard() {
  const { t } = useTranslation();
  const { ignoreBackground, isLoading, isSaving, setIgnoreBackground } = useGamepadSettings();

  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <EyeOff size={20} className="mt-0.5 shrink-0 text-default-500" />
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {t("settings.gamepad.ignoreBackgroundTitle", "Ignorar mando en segundo plano")}
              </h2>
              <p className="mt-0.5 text-sm text-default-500">
                {t(
                  "settings.gamepad.ignoreBackgroundSubtitle",
                  "Ignora joysticks y botones cuando SaveCloud no esté enfocado, evitando navegación accidental mientras juegas."
                )}
              </p>
            </div>
          </div>
          <Switch
            isSelected={ignoreBackground}
            onValueChange={setIgnoreBackground}
            isDisabled={isLoading || isSaving}
            aria-label={t("settings.gamepad.ignoreBackgroundTitle", "Ignorar mando en segundo plano")}
          />
        </div>
      </CardBody>
    </Card>
  );
}
