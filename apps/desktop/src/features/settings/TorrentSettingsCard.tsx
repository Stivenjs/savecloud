/**
 * @file TorrentSettingsCard.tsx
 * @description Tarjeta de configuración para límites de velocidad (throttling) y política de seeding en descargas torrent.
 * Construida con HeroUI y TanStack Query siguiendo vercel-react-best-practices.
 */

import { useState, useCallback, useMemo } from "react";
import { Card, CardBody, Select, SelectItem, Input, Button } from "@heroui/react";
import { ArrowDownCircle, ArrowUpCircle, Gauge, Share2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useTorrentSettings } from "@hooks/useTorrentSettings";
import { toastSuccess } from "@utils/toast";

const DOWNLOAD_PRESETS: Array<{ label: string; value: string; kbs: number | null }> = [
  { label: "settings.torrent.unlimited", value: "unlimited", kbs: null },
  { label: "1 MB/s (1024 KB/s)", value: "1024", kbs: 1024 },
  { label: "2 MB/s (2048 KB/s)", value: "2048", kbs: 2048 },
  { label: "5 MB/s (5120 KB/s)", value: "5120", kbs: 5120 },
  { label: "10 MB/s (10240 KB/s)", value: "10240", kbs: 10240 },
  { label: "25 MB/s (25600 KB/s)", value: "25600", kbs: 25600 },
  { label: "settings.torrent.custom", value: "custom", kbs: -1 },
];

const UPLOAD_PRESETS: Array<{ label: string; value: string; kbs: number | null }> = [
  { label: "settings.torrent.unlimited", value: "unlimited", kbs: null },
  { label: "250 KB/s", value: "250", kbs: 250 },
  { label: "500 KB/s", value: "500", kbs: 500 },
  { label: "1 MB/s (1024 KB/s)", value: "1024", kbs: 1024 },
  { label: "2 MB/s (2048 KB/s)", value: "2048", kbs: 2048 },
  { label: "5 MB/s (5120 KB/s)", value: "5120", kbs: 5120 },
  { label: "settings.torrent.custom", value: "custom", kbs: -1 },
];

export function TorrentSettingsCard() {
  const { t } = useTranslation();
  const { rateLimits, seedingMode, isLoading, isSavingLimits, isSavingSeeding, updateRateLimits, updateSeedingMode } =
    useTorrentSettings();

  const currentDownloadKbs = rateLimits.downloadLimitKbs;
  const currentUploadKbs = rateLimits.uploadLimitKbs;

  // Determinar si el valor de descarga es preset o personalizado
  const downloadSelectedKey = useMemo(() => {
    if (currentDownloadKbs === null || currentDownloadKbs === 0) return "unlimited";
    const found = DOWNLOAD_PRESETS.find((p) => p.kbs === currentDownloadKbs);
    return found ? found.value : "custom";
  }, [currentDownloadKbs]);

  // Determinar si el valor de subida es preset o personalizado
  const uploadSelectedKey = useMemo(() => {
    if (currentUploadKbs === null || currentUploadKbs === 0) return "unlimited";
    const found = UPLOAD_PRESETS.find((p) => p.kbs === currentUploadKbs);
    return found ? found.value : "custom";
  }, [currentUploadKbs]);

  const [customDownloadVal, setCustomDownloadVal] = useState<string>(
    currentDownloadKbs ? String(currentDownloadKbs) : ""
  );
  const [customUploadVal, setCustomUploadVal] = useState<string>(currentUploadKbs ? String(currentUploadKbs) : "");

  const handleDownloadPresetChange = useCallback(
    (key: string) => {
      if (key === "unlimited") {
        updateRateLimits({
          downloadLimitKbs: null,
          uploadLimitKbs: currentUploadKbs,
        });
      } else if (key === "custom") {
        const parsed = parseInt(customDownloadVal, 10);
        if (!isNaN(parsed) && parsed > 0) {
          updateRateLimits({
            downloadLimitKbs: parsed,
            uploadLimitKbs: currentUploadKbs,
          });
        }
      } else {
        const val = parseInt(key, 10);
        if (!isNaN(val)) {
          updateRateLimits({
            downloadLimitKbs: val,
            uploadLimitKbs: currentUploadKbs,
          });
        }
      }
    },
    [currentUploadKbs, customDownloadVal, updateRateLimits]
  );

  const handleUploadPresetChange = useCallback(
    (key: string) => {
      if (key === "unlimited") {
        updateRateLimits({
          downloadLimitKbs: currentDownloadKbs,
          uploadLimitKbs: null,
        });
      } else if (key === "custom") {
        const parsed = parseInt(customUploadVal, 10);
        if (!isNaN(parsed) && parsed > 0) {
          updateRateLimits({
            downloadLimitKbs: currentDownloadKbs,
            uploadLimitKbs: parsed,
          });
        }
      } else {
        const val = parseInt(key, 10);
        if (!isNaN(val)) {
          updateRateLimits({
            downloadLimitKbs: currentDownloadKbs,
            uploadLimitKbs: val,
          });
        }
      }
    },
    [currentDownloadKbs, customUploadVal, updateRateLimits]
  );

  const handleSaveCustomDownload = useCallback(() => {
    const val = parseInt(customDownloadVal, 10);
    if (!isNaN(val) && val > 0) {
      updateRateLimits({
        downloadLimitKbs: val,
        uploadLimitKbs: currentUploadKbs,
      });
      toastSuccess(t("settings.torrent.limitsSaved", "Límite de descarga actualizado"));
    }
  }, [customDownloadVal, currentUploadKbs, updateRateLimits, t]);

  const handleSaveCustomUpload = useCallback(() => {
    const val = parseInt(customUploadVal, 10);
    if (!isNaN(val) && val > 0) {
      updateRateLimits({
        downloadLimitKbs: currentDownloadKbs,
        uploadLimitKbs: val,
      });
      toastSuccess(t("settings.torrent.limitsSaved", "Límite de subida actualizado"));
    }
  }, [customUploadVal, currentDownloadKbs, updateRateLimits, t]);

  return (
    <Card>
      <CardBody className="gap-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Gauge size={20} className="mt-0.5 shrink-0 text-default-500" />
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {t("settings.torrent.title", "Red y Transferencia Torrent (P2P)")}
            </h2>
            <p className="mt-0.5 text-sm text-default-500">
              {t(
                "settings.torrent.subtitle",
                "Controla la velocidad de red de librqbit y el comportamiento de compartición con otros jugadores."
              )}
            </p>
          </div>
        </div>

        {/* Sección Límites de Ancho de Banda */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-medium border-small border-divider p-4">
          {/* Límite de Descarga */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ArrowDownCircle size={16} className="text-success" />
              <span>{t("settings.torrent.downloadLimit", "Límite de velocidad de descarga")}</span>
            </div>
            <p className="text-xs text-default-500">
              {t("settings.torrent.downloadLimitDesc", "Evita saturar tu conexión mientras descargas juegos.")}
            </p>
            <Select
              size="sm"
              selectedKeys={[downloadSelectedKey]}
              onSelectionChange={(keys) => {
                const key = Array.from(keys)[0] as string;
                if (key) handleDownloadPresetChange(key);
              }}
              isDisabled={isLoading || isSavingLimits}
              aria-label={t("settings.torrent.downloadLimit", "Límite de descarga")}
              className="max-w-full">
              {DOWNLOAD_PRESETS.map((preset) => (
                <SelectItem key={preset.value}>
                  {preset.label.startsWith("settings.") ? t(preset.label, preset.value) : preset.label}
                </SelectItem>
              ))}
            </Select>

            {downloadSelectedKey === "custom" && (
              <div className="flex items-center gap-2 mt-2">
                <Input
                  size="sm"
                  type="number"
                  placeholder="KB/s"
                  value={customDownloadVal}
                  onValueChange={setCustomDownloadVal}
                  endContent={<span className="text-xs text-default-400">KB/s</span>}
                />
                <Button size="sm" color="primary" variant="flat" onPress={handleSaveCustomDownload}>
                  {t("common.save", "Guardar")}
                </Button>
              </div>
            )}
          </div>

          {/* Límite de Subida */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ArrowUpCircle size={16} className="text-primary" />
              <span>{t("settings.torrent.uploadLimit", "Límite de velocidad de subida")}</span>
            </div>
            <p className="text-xs text-default-500">
              {t("settings.torrent.uploadLimitDesc", "Limita el ancho de banda saliente al compartir.")}
            </p>
            <Select
              size="sm"
              selectedKeys={[uploadSelectedKey]}
              onSelectionChange={(keys) => {
                const key = Array.from(keys)[0] as string;
                if (key) handleUploadPresetChange(key);
              }}
              isDisabled={isLoading || isSavingLimits}
              aria-label={t("settings.torrent.uploadLimit", "Límite de subida")}
              className="max-w-full">
              {UPLOAD_PRESETS.map((preset) => (
                <SelectItem key={preset.value}>
                  {preset.label.startsWith("settings.") ? t(preset.label, preset.value) : preset.label}
                </SelectItem>
              ))}
            </Select>

            {uploadSelectedKey === "custom" && (
              <div className="flex items-center gap-2 mt-2">
                <Input
                  size="sm"
                  type="number"
                  placeholder="KB/s"
                  value={customUploadVal}
                  onValueChange={setCustomUploadVal}
                  endContent={<span className="text-xs text-default-400">KB/s</span>}
                />
                <Button size="sm" color="primary" variant="flat" onPress={handleSaveCustomUpload}>
                  {t("common.save", "Guardar")}
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Sección Comportamiento de Seeding */}
        <div className="rounded-medium border-small border-divider p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Share2 size={16} className="text-secondary" />
            <span>{t("settings.torrent.seedingModeTitle", "Comportamiento de Seeding (Compartición)")}</span>
          </div>
          <p className="text-xs text-default-500">
            {t(
              "settings.torrent.seedingModeSubtitle",
              "Determina si la app libera los archivos de inmediato o continúa sembrando para apoyar a otros jugadores."
            )}
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {/* Opción 1: Detener al completar */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => !isSavingSeeding && updateSeedingMode("stop_on_complete")}
              onKeyDown={(e) => {
                if (!isSavingSeeding && (e.key === "Enter" || e.key === " ")) updateSeedingMode("stop_on_complete");
              }}
              className={`cursor-pointer rounded-medium p-3.5 border transition-all ${
                isSavingSeeding ? "opacity-60 pointer-events-none" : ""
              } ${
                seedingMode === "stop_on_complete"
                  ? "border-primary bg-primary/10 shadow-xs"
                  : "border-divider bg-content2/40 hover:bg-content2/70"
              }`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">
                  {t("settings.torrent.stopOnComplete", "Detener subida al completar")}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-default-200 text-default-700">
                  {t("common.recommended", "Recomendado")}
                </span>
              </div>
              <p className="text-xs text-default-500 mt-1 leading-relaxed">
                {t(
                  "settings.torrent.stopOnCompleteDesc",
                  "Cierra los archivos inmediatamente al llegar al 100%. Permite mover, descomprimir o jugar sin bloqueos de archivo."
                )}
              </p>
            </div>

            {/* Opción 2: Sembrar hasta ratio 1.0 */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => !isSavingSeeding && updateSeedingMode("seed_ratio_1")}
              onKeyDown={(e) => {
                if (!isSavingSeeding && (e.key === "Enter" || e.key === " ")) updateSeedingMode("seed_ratio_1");
              }}
              className={`cursor-pointer rounded-medium p-3.5 border transition-all ${
                isSavingSeeding ? "opacity-60 pointer-events-none" : ""
              } ${
                seedingMode === "seed_ratio_1"
                  ? "border-primary bg-primary/10 shadow-xs"
                  : "border-divider bg-content2/40 hover:bg-content2/70"
              }`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">
                  {t("settings.torrent.seedRatio1", "Compartir hasta ratio 1.0")}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-secondary-100 text-secondary-700">
                  {t("settings.torrent.community", "Comunidad")}
                </span>
              </div>
              <p className="text-xs text-default-500 mt-1 leading-relaxed">
                {t(
                  "settings.torrent.seedRatio1Desc",
                  "Continúa subiendo piezas hasta alcanzar 1.0 (subir la misma cantidad descargada) para ayudar a otros usuarios."
                )}
              </p>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
