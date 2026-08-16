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
  Sparkles,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";
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
      `# 📊 SaveCloud - Reporte de Simulación Streaming TAR`,
      `**Juego:** ${gameName} (\`${currentMetrics.gameId}\`)`,
      `**Archivo:** \`${currentMetrics.filename}\``,
      ``,
      `### 🗜️ Métricas de Compresión`,
      `- **Tamaño Original:** ${orig}`,
      `- **Tamaño Comprimido:** ${comp}`,
      `- **Espacio Ahorrado:** ${saved} (-${currentMetrics.savedPercentage.toFixed(1)}%)`,
      `- **Ratio de Compresión:** ${currentMetrics.savedRatio.toFixed(2)}x`,
      `- **Nivel Zstd:** ${currentMetrics.zstdLevel} (${currentMetrics.threads} hilos CPU)`,
      ``,
      `### ⚡ Rendimiento`,
      `- **Tiempo Total:** ${formattedDuration}`,
      `- **Velocidad de Procesamiento:** ${currentMetrics.throughputMbS.toFixed(1)} MB/s`,
      `- **Tasa de Stream de Salida:** ${currentMetrics.outputThroughputMbS.toFixed(1)} MB/s`,
      ``,
      `### 📁 Estructura del Backup`,
      `- **Archivos empaquetados:** ${currentMetrics.totalFiles.toLocaleString()}`,
      `- **Carpetas:** ${currentMetrics.totalDirs.toLocaleString()}`,
      `- **Enlaces simbólicos:** ${currentMetrics.totalSymlinks.toLocaleString()}`,
      `- **Chunks de stream:** ${currentMetrics.chunksCount.toLocaleString()}`,
      `- **Simulación S3 Multipart:** ${currentMetrics.simulatedPartsCount} partes de ${formatBytes(currentMetrics.simulatedPartSize)} c/u`,
      ``,
      `*Generado en SaveCloud (${new Date(currentMetrics.timestamp ?? Date.now()).toLocaleString()})*`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback si falla portapapeles
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
      scrollBehavior="inside"
      backdrop="blur"
      classNames={{
        base: "bg-zinc-950/95 border border-white/10 shadow-2xl backdrop-blur-xl",
        header: "border-b border-white/10 pb-3",
        footer: "border-t border-white/10 pt-3",
      }}>
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary border border-primary/30 shadow-inner">
                <Gauge size={20} />
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                  {t("streaming.metrics.title", "Métricas de Streaming TAR")}
                  <Chip
                    size="sm"
                    color="warning"
                    variant="flat"
                    className="text-[10px] font-semibold uppercase tracking-wider h-5">
                    {t("streaming.metrics.dryRunBadge", "Modo Prueba")}
                  </Chip>
                </h2>
                <p className="text-xs text-default-400">
                  {gameName ? `${gameName} · ` : ""}
                  {t("streaming.metrics.subtitle", "Resultados del empaquetado y compresión sin subida")}
                </p>
              </div>
            </div>
            <Chip size="sm" color="success" variant="dot" className="border-none text-xs">
              ZSTD Lv.{currentMetrics.zstdLevel}
            </Chip>
          </div>
        </ModalHeader>

        <ModalBody className="py-4 space-y-4 text-foreground">
          {/* HERO COMPARISON CARD */}
          <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-linear-to-br from-primary/10 via-default-900/40 to-background p-4 shadow-lg">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              {/* Original */}
              <div className="flex flex-col items-center sm:items-start text-center sm:text-left">
                <span className="text-xs font-medium uppercase tracking-wider text-default-400 flex items-center gap-1.5">
                  <HardDrive size={13} className="text-default-400" />
                  {t("streaming.metrics.originalSize", "Tamaño Original")}
                </span>
                <span className="mt-1 text-2xl font-bold font-mono text-foreground">{originalFormatted}</span>
                <span className="text-[11px] text-default-500">
                  {currentMetrics.totalFiles} {t("streaming.metrics.filesLabel", "archivos")}
                </span>
              </div>

              {/* Arrow transformation */}
              <div className="flex flex-col items-center justify-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-primary border border-primary/40 shadow-sm animate-pulse">
                  <ArrowRight size={16} />
                </div>
                <span className="mt-1 text-[10px] font-semibold text-primary uppercase tracking-wider">
                  {currentMetrics.savedRatio.toFixed(2)}x {t("streaming.metrics.ratioLabel", "ratio")}
                </span>
              </div>

              {/* Compressed */}
              <div className="flex flex-col items-center sm:items-end text-center sm:text-right">
                <span className="text-xs font-medium uppercase tracking-wider text-primary flex items-center gap-1.5">
                  <Archive size={13} className="text-primary" />
                  {t("streaming.metrics.compressedSize", "Comprimido (TAR.ZST)")}
                </span>
                <span className="mt-1 text-2xl font-bold font-mono text-emerald-400">{compressedFormatted}</span>
                <Chip size="sm" color="success" variant="flat" className="mt-1 font-semibold text-xs h-5">
                  -{savedFormatted} (-{currentMetrics.savedPercentage.toFixed(1)}%)
                </Chip>
              </div>
            </div>

            {/* Visual ratio bar */}
            <div className="mt-4">
              <div className="flex items-center justify-between text-[11px] text-default-400 mb-1">
                <span>{t("streaming.metrics.compressionRatioBar", "Reducción de espacio")}</span>
                <span className="font-semibold text-emerald-400">
                  {t("streaming.metrics.spaceSavedLabel", "Ahorro")}: {currentMetrics.savedPercentage.toFixed(1)}%
                </span>
              </div>
              <div className="h-3 w-full rounded-full bg-default-200/20 overflow-hidden relative border border-white/5">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${percentageWidth}%` }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                  className="h-full rounded-full bg-linear-to-r from-primary to-emerald-400 relative">
                  <div className="absolute inset-0 bg-white/20 animate-pulse" />
                </motion.div>
              </div>
              <div className="flex items-center justify-between text-[10px] text-default-500 mt-1">
                <span>
                  {compressedFormatted} ({percentageWidth}%)
                </span>
                <span>{originalFormatted} (100%)</span>
              </div>
            </div>
          </div>

          {/* METRICS GRID */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {/* Duración */}
            <div className="rounded-xl border border-white/10 bg-default-100/40 p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between text-default-400">
                <span className="text-[11px] font-medium uppercase tracking-wider">
                  {t("streaming.metrics.duration", "Tiempo")}
                </span>
                <Clock size={14} className="text-amber-400" />
              </div>
              <div className="mt-2">
                <span className="text-lg font-bold font-mono text-foreground">{formattedDuration}</span>
                <p className="text-[10px] text-default-500">
                  {t("streaming.metrics.packagingTime", "Empaquetado y zstd")}
                </p>
              </div>
            </div>

            {/* Throughput */}
            <div className="rounded-xl border border-white/10 bg-default-100/40 p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between text-default-400">
                <span className="text-[11px] font-medium uppercase tracking-wider">
                  {t("streaming.metrics.speed", "Velocidad")}
                </span>
                <Zap size={14} className="text-primary" />
              </div>
              <div className="mt-2">
                <span className="text-lg font-bold font-mono text-primary">
                  {currentMetrics.throughputMbS.toFixed(1)} <span className="text-xs">MB/s</span>
                </span>
                <p className="text-[10px] text-default-500">{t("streaming.metrics.rawThroughput", "Entrada cruda")}</p>
              </div>
            </div>

            {/* Output Throughput */}
            <div className="rounded-xl border border-white/10 bg-default-100/40 p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between text-default-400">
                <span className="text-[11px] font-medium uppercase tracking-wider">
                  {t("streaming.metrics.streamRate", "Stream")}
                </span>
                <Sparkles size={14} className="text-emerald-400" />
              </div>
              <div className="mt-2">
                <span className="text-lg font-bold font-mono text-emerald-400">
                  {currentMetrics.outputThroughputMbS.toFixed(1)} <span className="text-xs">MB/s</span>
                </span>
                <p className="text-[10px] text-default-500">
                  {t("streaming.metrics.streamThroughput", "Salida comprimida")}
                </p>
              </div>
            </div>

            {/* CPU Threads */}
            <div className="rounded-xl border border-white/10 bg-default-100/40 p-3 flex flex-col justify-between">
              <div className="flex items-center justify-between text-default-400">
                <span className="text-[11px] font-medium uppercase tracking-wider">
                  {t("streaming.metrics.threads", "Hilos CPU")}
                </span>
                <Cpu size={14} className="text-cyan-400" />
              </div>
              <div className="mt-2">
                <span className="text-lg font-bold font-mono text-foreground">
                  {currentMetrics.threads} <span className="text-xs">hilos</span>
                </span>
                <p className="text-[10px] text-default-500">Zstd multithread</p>
              </div>
            </div>
          </div>

          {/* DETAILED STATS SECTION */}
          <div className="rounded-xl border border-white/10 bg-default-100/30 p-3 space-y-2.5">
            <h3 className="text-xs font-semibold text-default-400 uppercase tracking-wider flex items-center gap-1.5">
              <Layers size={13} className="text-default-400" />
              {t("streaming.metrics.detailsHeader", "Detalles de Estructura y Simulación S3")}
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-default-100/50">
                <FileCode size={16} className="text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-default-400 text-[10px]">{t("streaming.metrics.files", "Archivos procesados")}</p>
                  <p className="font-semibold text-foreground font-mono">
                    {currentMetrics.totalFiles.toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 p-2 rounded-lg bg-default-100/50">
                <FolderTree size={16} className="text-amber-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-default-400 text-[10px]">{t("streaming.metrics.folders", "Directorios")}</p>
                  <p className="font-semibold text-foreground font-mono">{currentMetrics.totalDirs.toLocaleString()}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 p-2 rounded-lg bg-default-100/50">
                <Archive size={16} className="text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-default-400 text-[10px]">
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

        <ModalFooter className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="flat"
            color="default"
            startContent={copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
            onPress={handleCopyReport}
            className="text-xs">
            {copied ? t("common.copied", "Copiado!") : t("streaming.metrics.copyReport", "Copiar reporte")}
          </Button>

          <Button size="sm" color="primary" onPress={closeMetricsModal} className="text-xs font-semibold px-4">
            {t("common.close", "Cerrar")}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
