/**
 * @file GameExitSyncCard.tsx
 * @description Tarjeta de configuración para activar/desactivar la subida automática al salir del juego.
 * Construida con HeroUI y TanStack Query siguiendo vercel-react-best-practices.
 */

import { Card, CardBody, Switch } from "@heroui/react";
import { CloudUpload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGameExitSyncSettings } from "@hooks/useGameExitSyncSettings";

export function GameExitSyncCard() {
  const { t } = useTranslation();
  const { autoSyncOnGameExit, isLoading, isSaving, setAutoSyncOnGameExit } = useGameExitSyncSettings();

  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <CloudUpload size={20} className="mt-0.5 shrink-0 text-default-500" />
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {t("settings.sync.autoSyncOnExitTitle", "Subir guardados al salir del juego")}
              </h2>
              <p className="mt-0.5 text-sm text-default-500">
                {t(
                  "settings.sync.autoSyncOnExitSubtitle",
                  "Sincroniza y respalda tus partidas en la nube automáticamente en cuanto se detecta que un juego se ha cerrado."
                )}
              </p>
            </div>
          </div>
          <Switch
            isSelected={autoSyncOnGameExit}
            onValueChange={setAutoSyncOnGameExit}
            isDisabled={isLoading || isSaving}
            aria-label={t("settings.sync.autoSyncOnExitTitle", "Subir guardados al salir del juego")}
          />
        </div>
      </CardBody>
    </Card>
  );
}
