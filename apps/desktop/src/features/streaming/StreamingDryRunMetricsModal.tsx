import { useState, useCallback, useMemo } from "react";
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Chip } from "@heroui/react";
import {
  Archive,
  ArrowRight,
  Check,
  Clock,
  Copy,
  Cpu,
  FileCode,
  FolderTree,
  Gauge,
  HardDrive,
  Layers,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStreamingMetricsStore } from "@store/StreamingMetricsStore";
import { formatGameDisplayName } from "@utils/gameImage";
import { formatBytes } from "@utils/format";

export function StreamingDryRunMetricsModal() {
  const { t } = useTranslation();
  const currentMetrics = useStreamingMetricsStore((s) => s.currentMetrics);
  const isModalOpen = useStreamingMetricsStore((s) => s.isModalOpen);
  const closeMetricsModal = useStreamingMetricsStore((s) => s.closeMetricsModal);

  const [copied, setCopied] = useState(false);

  const gameName = useMemo(() => {
    return currentMetrics?.gameId ? formatGameDisplayName(currentMetrics.gameId) : "";
  }, [currentMetrics?.gameId]);

  const formattedDuration = useMemo(() => {
    if (!currentMetrics) return "0 ms";
    if (currentMetrics.durationMs < 1000) {
      return `${currentMetrics.durationMs} ms`;
    }
    return `${(currentMetrics.durationMs / 1000).toFixed(2)} s`;
  }, [currentMetrics]);

  const handleCopyReport = useCallback(async () => {
    if (!currentMetrics) return;

    const orig = formatBytes(currentMetrics.originalBytes);
    const comp = formatBytes(currentMetrics.compressedBytes);
    const saved = formatBytes(currentMetrics.savedBytes);

    const report = [
      `# Reporte de Simulación Streaming TAR - SaveCloud`,
      `Juego: ${gameName} (${currentMetrics.gameId})`,
      `Archivo: ${currentMetrics.filename}`,
      ``,
      `## Métricas de Compresión`,
      `- Tamaño original: ${orig}`,
      `- Tamaño comprimido: ${comp}`,
      `- Espacio ahorrado: ${saved} (-${currentMetrics.savedPercentage.toFixed(1)}%)`,
      `- Ratio de compresión: ${currentMetrics.savedRatio.toFixed(2)}x`,
      `- Nivel Zstd: ${currentMetrics.zstdLevel} (${currentMetrics.threads} hilos CPU)`,
      ``,
      `## Rendimiento`,
      `- Tiempo total: ${formattedDuration}`,
      `- Velocidad de procesamiento: ${currentMetrics.throughputMbS.toFixed(1)} MB/s`,
      `- Tasa de stream de salida: ${currentMetrics.outputThroughputMbS.toFixed(1)} MB/s`,
      ``,
      `## Estructura del Backup`,
      `- Archivos empaquetados: ${currentMetrics.totalFiles.toLocaleString()}`,
      `- Carpetas: ${currentMetrics.totalDirs.toLocaleString()}`,
      `- Enlaces simbólicos: ${currentMetrics.totalSymlinks.toLocaleString()}`,
      `- Chunks de stream: ${currentMetrics.chunksCount.toLocaleString()}`,
      `- Simulación S3 Multipart: ${currentMetrics.simulatedPartsCount} partes de ${formatBytes(currentMetrics.simulatedPartSize)} c/u`,
      ``,
      `Generado en SaveCloud (${new Date(currentMetrics.timestamp ?? Date.now()).toLocaleString()})`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback silencioso si falla portapapeles
    }
  }, [currentMetrics, gameName, formattedDuration]);

  if (!currentMetrics) {
    return null;
  }

  const originalFormatted = formatBytes(currentMetrics.originalBytes);
  const compressedFormatted = formatBytes(currentMetrics.compressedBytes);
  const savedFormatted = formatBytes(currentMetrics.savedBytes);
  const percentageWidth = Math.max(
    5,
    Math.min(100, Math.round((currentMetrics.compressedBytes / Math.max(1, currentMetrics.originalBytes)) * 100))
  );

  return (
    <Modal
      isOpen={isModalOpen}
      onOpenChange={(open) => {
        if (!open) closeMetricsModal();
      }}
      size="2xl"
      scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center justify-between gap-3 border-b border-default-200/60 pb-3">
          <div className="flex items-center gap-2.5">
            <Gauge size={20} className="text-primary shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {t("streaming.metrics.title", "Métricas de compresión")}
              </h2>
              <p className="text-xs text-default-500 font-normal">
                {gameName ? `${gameName} · ` : ""}
                {t("streaming.metrics.subtitle", "Simulación de empaquetado y compresión sin subida")}
              </p>
            </div>
          </div>
          <Chip size="sm" color="primary" variant="flat" className="font-semibold text-xs shrink-0">
            Zstd Nivel {currentMetrics.zstdLevel}
          </Chip>
        </ModalHeader>

        <ModalBody className="py-4 space-y-4">
          {/* COMPARACIÓN ORIGINAL VS COMPRIMIDO */}
          <div className="rounded-xl border border-default-200 bg-default-100/50 p-4 space-y-3">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              {/* Tamaño Original */}
              <div className="flex flex-col items-center sm:items-start text-center sm:text-left">
                <span className="text-xs font-medium text-default-500 flex items-center gap-1.5">
                  <HardDrive size={14} className="text-default-400" />
                  {t("streaming.metrics.originalSize", "Tamaño original")}
                </span>
                <span className="mt-1 text-xl font-bold font-mono text-foreground">{originalFormatted}</span>
                <span className="text-[11px] text-default-400">
                  {currentMetrics.totalFiles} {t("streaming.metrics.filesLabel", "archivos")}
                </span>
              </div>

              {/* Indicador de Ratio */}
              <div className="flex flex-col items-center justify-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-default-200 text-default-600">
                  <ArrowRight size={16} />
                </div>
                <span className="mt-1 text-xs font-semibold text-primary">
                  {currentMetrics.savedRatio.toFixed(2)}x {t("streaming.metrics.ratioLabel", "ratio")}
                </span>
              </div>

              {/* Tamaño Comprimido */}
              <div className="flex flex-col items-center sm:items-end text-center sm:text-right">
                <span className="text-xs font-medium text-default-500 flex items-center gap-1.5">
                  <Archive size={14} className="text-primary" />
                  {t("streaming.metrics.compressedSize", "Comprimido (TAR.ZST)")}
                </span>
                <span className="mt-1 text-xl font-bold font-mono text-primary">{compressedFormatted}</span>
                <Chip size="sm" color="success" variant="flat" className="mt-1 font-semibold text-xs h-5">
                  -{savedFormatted} (-{currentMetrics.savedPercentage.toFixed(1)}%)
                </Chip>
              </div>
            </div>

            {/* Barra de progreso de compresión */}
            <div className="pt-2 border-t border-default-200/60">
              <div className="flex items-center justify-between text-xs text-default-500 mb-1.5">
                <span>{t("streaming.metrics.compressionRatioBar", "Ocupación tras compresión")}</span>
                <span className="font-medium text-foreground">
                  {t("streaming.metrics.spaceSavedLabel", "Ahorro")}: {currentMetrics.savedPercentage.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-default-200 overflow-hidden">
                <div
                  style={{ width: `${percentageWidth}%` }}
                  className="h-full rounded-full bg-primary transition-all duration-500"
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-default-400 mt-1">
                <span>
                  {compressedFormatted} ({percentageWidth}%)
                </span>
                <span>{originalFormatted} (100%)</span>
              </div>
            </div>
          </div>

          {/* CUADRÍCULA DE RENDIMIENTO */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {/* Duración */}
            <div className="rounded-xl border border-default-200 bg-default-50 p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between text-default-500">
                <span className="text-xs font-medium">{t("streaming.metrics.duration", "Tiempo")}</span>
                <Clock size={14} className="text-default-400" />
              </div>
              <div className="mt-2">
                <span className="text-base font-bold font-mono text-foreground">{formattedDuration}</span>
                <p className="text-[11px] text-default-400">
                  {t("streaming.metrics.packagingTime", "Empaquetado total")}
                </p>
              </div>
            </div>

            {/* Velocidad de lectura */}
            <div className="rounded-xl border border-default-200 bg-default-50 p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between text-default-500">
                <span className="text-xs font-medium">{t("streaming.metrics.speed", "Lectura")}</span>
                <Zap size={14} className="text-primary" />
              </div>
              <div className="mt-2">
                <span className="text-base font-bold font-mono text-foreground">
                  {currentMetrics.throughputMbS.toFixed(1)} <span className="text-xs text-default-500">MB/s</span>
                </span>
                <p className="text-[11px] text-default-400">{t("streaming.metrics.rawThroughput", "Entrada cruda")}</p>
              </div>
            </div>

            {/* Salida comprimida */}
            <div className="rounded-xl border border-default-200 bg-default-50 p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between text-default-500">
                <span className="text-xs font-medium">{t("streaming.metrics.streamRate", "Salida")}</span>
                <Archive size={14} className="text-default-400" />
              </div>
              <div className="mt-2">
                <span className="text-base font-bold font-mono text-foreground">
                  {currentMetrics.outputThroughputMbS.toFixed(1)} <span className="text-xs text-default-500">MB/s</span>
                </span>
                <p className="text-[11px] text-default-400">
                  {t("streaming.metrics.streamThroughput", "Flujo comprimido")}
                </p>
              </div>
            </div>

            {/* Hilos CPU */}
            <div className="rounded-xl border border-default-200 bg-default-50 p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between text-default-500">
                <span className="text-xs font-medium">{t("streaming.metrics.threads", "Hilos CPU")}</span>
                <Cpu size={14} className="text-default-400" />
              </div>
              <div className="mt-2">
                <span className="text-base font-bold font-mono text-foreground">
                  {currentMetrics.threads} <span className="text-xs text-default-500">hilos</span>
                </span>
                <p className="text-[11px] text-default-400">Paralelismo Zstd</p>
              </div>
            </div>
          </div>

          {/* DETALLES DE ESTRUCTURA */}
          <div className="rounded-xl border border-default-200 bg-default-50 p-3 space-y-2.5">
            <h3 className="text-xs font-semibold text-default-500 uppercase tracking-wider flex items-center gap-1.5">
              <Layers size={13} className="text-default-400" />
              {t("streaming.metrics.detailsHeader", "Estructura del empaquetado")}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-default-100/60 border border-default-200/40">
                <FileCode size={16} className="text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-default-400 text-[11px]">{t("streaming.metrics.files", "Archivos procesados")}</p>
                  <p className="font-semibold text-foreground font-mono">
                    {currentMetrics.totalFiles.toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-default-100/60 border border-default-200/40">
                <FolderTree size={16} className="text-default-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-default-400 text-[11px]">{t("streaming.metrics.folders", "Directorios")}</p>
                  <p className="font-semibold text-foreground font-mono">{currentMetrics.totalDirs.toLocaleString()}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-default-100/60 border border-default-200/40">
                <Archive size={16} className="text-default-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-default-400 text-[11px]">
                    {t("streaming.metrics.s3Parts", "Partes S3 estimadas")}
                  </p>
                  <p className="font-semibold text-foreground font-mono">
                    {currentMetrics.simulatedPartsCount} × {formatBytes(currentMetrics.simulatedPartSize)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </ModalBody>

        <ModalFooter className="flex items-center justify-between gap-2 border-t border-default-200/60 pt-3">
          <Button
            size="sm"
            variant="flat"
            startContent={copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
            onPress={handleCopyReport}
            className="text-xs">
            {copied ? t("common.copied", "Copiado") : t("streaming.metrics.copyReport", "Copiar reporte")}
          </Button>

          <Button size="sm" color="primary" onPress={closeMetricsModal} className="text-xs font-semibold px-4">
            {t("common.close", "Cerrar")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
