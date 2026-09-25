/**
 * @file RemotePlayPage.tsx
 * @description Vista principal para el centro de mando de Remote Play en SaveCloud Desktop.
 * Integra perfectamente con el fondo ambiental global de la aplicación (AppAmbientBackground).
 */

import { useTranslation } from "react-i18next";
import { Chip } from "@heroui/react";
import { StreamingPanel } from "@components/streaming/StreamingPanel";

/**
 * Página principal de Remote Play.
 * Renderiza el encabezado del panel de control y el módulo central de StreamingPanel.
 *
 * @returns {JSX.Element} Vista de la página Remote Play
 */
export default function RemotePlayPage() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-6 p-6 md:p-8 h-full overflow-y-auto bg-transparent">
      {/* Encabezado principal de la página */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("remotePlay.pageTitle")}</h1>
          <Chip
            color="primary"
            variant="flat"
            size="sm"
            className="font-semibold border border-primary/20 bg-primary/10 text-primary">
            Zero-Config LAN
          </Chip>
        </div>
        <p className="text-sm text-default-500 max-w-2xl">{t("remotePlay.pageDesc")}</p>
      </div>

      {/* Contenedor central del panel de streaming */}
      <div className="flex-1 flex justify-start">
        <StreamingPanel />
      </div>
    </div>
  );
}
