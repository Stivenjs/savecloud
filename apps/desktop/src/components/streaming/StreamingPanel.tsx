/**
 * @file StreamingPanel.tsx
 * @description Panel principal de Remote Play integrado con el sistema de diseño SaveCloud.
 * Utiliza los tokens de color del tema (primary, default, content1), bordes sutiles y tarjetas adaptativas.
 */

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Card, CardHeader, CardBody, Slider, Switch, Chip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { Video, Monitor, Gamepad2, Sliders, ShieldCheck, Zap, Layers, Radio, UserX } from "lucide-react";
import { HostSetupModal } from "@components/streaming/HostSetupModal";
import { LanHostList } from "@components/streaming/LanHostList";
import { ClientConnectModal } from "@components/streaming/ClientConnectModal";
import { useStreamingState, StreamingState } from "@hooks/queries/useStreamingQueries";
import {
  CODEC_OPTIONS,
  getSavedStreamingConfig,
  RESOLUTION_OPTIONS,
  saveStreamingConfig,
  StreamingCodec,
  StreamingConfig,
  StreamingFps,
  StreamingPreset,
  StreamingResolution,
} from "@components/streaming/streamingTypes";

export type { StreamingState };

/**
 * Componente principal del panel de Remote Play.
 * Alineado al sistema de diseño SaveCloud (Emerald / Dark Slate / Minimal borders).
 *
 * @returns {JSX.Element} Panel de Remote Play estilizado
 */
export const StreamingPanel = () => {
  const { t } = useTranslation();

  // Estado del modal de Host y Buscador LAN
  const [isHostModalOpen, setIsHostModalOpen] = useState(false);
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [isMirrorConnecting, setIsMirrorConnecting] = useState(false);

  // Configuración de streaming persistente
  const [config, setConfig] = useState<StreamingConfig>(() => getSavedStreamingConfig());

  // Consulta del estado actual del motor Tauri Rust
  const { data: state } = useStreamingState();

  const isHosting = typeof state === "object" && state !== null && "Hosting" in state;
  const isPlaying = typeof state === "object" && state !== null && "Playing" in state;
  const isIdle = state === "Idle" || state === "NotInstalled" || state === "Stopped";

  const playingHostIp =
    isPlaying && typeof state === "object" && state !== null && "Playing" in state ? state.Playing.host_ip : "";
  const hostingPin =
    isHosting && typeof state === "object" && state !== null && "Hosting" in state ? state.Hosting.pin : "";
  const hostingClients =
    isHosting && typeof state === "object" && state !== null && "Hosting" in state ? state.Hosting.clients || [] : [];
  const hasActiveViewer = hostingClients.length > 0;

  const handleCancelActiveSession = async () => {
    try {
      await invoke("streaming_cancel_active_session");
    } catch (err) {
      console.error("Error al desconectar espectador:", err);
    }
  };

  /** Actualiza la configuración local y persistida. */
  const updateConfig = useCallback((updater: (prev: StreamingConfig) => StreamingConfig) => {
    setConfig((prev) => {
      const next = updater(prev);
      saveStreamingConfig(next);
      return next;
    });
  }, []);

  /** Aplica presets de rendimiento prediseñados. */
  const handlePresetSelect = (preset: StreamingPreset) => {
    updateConfig((prev) => {
      if (preset === "ultra_low_latency") {
        return {
          ...prev,
          preset: "ultra_low_latency",
          resolution: "1080p",
          fps: 60,
          bitrateMbps: 45,
          codec: "h265",
          lowLatencyMode: true,
        };
      }
      if (preset === "balanced") {
        return {
          ...prev,
          preset: "balanced",
          resolution: "1080p",
          fps: 60,
          bitrateMbps: 30,
          codec: "h264",
          lowLatencyMode: false,
        };
      }
      if (preset === "high_fps") {
        return {
          ...prev,
          preset: "high_fps",
          resolution: "1080p",
          fps: 120,
          bitrateMbps: 55,
          codec: "h265",
          lowLatencyMode: true,
        };
      }
      return { ...prev, preset: "custom" };
    });
  };

  /** Detiene la sesión activa (Host o Cliente). */
  const handleStop = async () => {
    try {
      await invoke("streaming_stop");
    } catch (err) {
      console.error("Error al detener streaming:", err);
    }
  };

  const handleMirrorConnect = () => {
    setIsMirrorConnecting(true);
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-5xl">
      {/* Banner de Estado de Sesión Activa */}
      {isHosting ? (
        <Card
          className={`transition-all duration-300 shadow-xs overflow-hidden ${
            hasActiveViewer
              ? "bg-emerald-500/15 border border-emerald-500/40 dark:bg-emerald-900/20"
              : "bg-success-500/10 border border-success-500/30"
          }`}>
          <CardBody className="p-5 flex flex-row items-center justify-between gap-4 overflow-hidden">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                {hasActiveViewer ? (
                  <Chip
                    color="success"
                    variant="flat"
                    size="sm"
                    startContent={<Radio size={14} className="animate-pulse text-success-500 ml-1" />}
                    className="font-bold border border-emerald-500/30">
                    {t("remotePlay.viewerConnected")}
                  </Chip>
                ) : (
                  <Chip color="success" variant="flat" size="sm" className="font-semibold border border-success-500/20">
                    {t("remotePlay.hostingActive")}
                  </Chip>
                )}
                {hostingPin ? (
                  <span className="text-xs font-mono bg-default-100 px-2 py-0.5 rounded border border-default-200/50">
                    PIN: <strong className="text-success-500">{hostingPin}</strong>
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-default-500 max-w-xl">
                {hasActiveViewer
                  ? t("remotePlay.viewerConnectedDesc", { count: hostingClients.length })
                  : t("remotePlay.hostingDesc")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {hasActiveViewer ? (
                <Button
                  color="warning"
                  variant="flat"
                  size="sm"
                  startContent={<UserX size={14} />}
                  onPress={handleCancelActiveSession}
                  className="font-medium">
                  {t("remotePlay.disconnectViewer")}
                </Button>
              ) : null}
              <Button color="danger" variant="flat" size="sm" onPress={handleStop} className="font-medium">
                {t("remotePlay.stopHost")}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {isPlaying ? (
        <Card className="bg-primary/10 border border-primary/30 shadow-xs overflow-hidden">
          <CardBody className="p-5 flex flex-row items-center justify-between gap-4 overflow-hidden">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Chip color="primary" variant="flat" size="sm" className="font-semibold border border-primary/20">
                  {t("remotePlay.connectedToHost")}
                </Chip>
                <span className="text-xs font-mono text-default-400">{playingHostIp}</span>
              </div>
              <p className="text-xs text-default-500">{t("remotePlay.connectedDesc", { hostIp: playingHostIp })}</p>
            </div>
            <Button color="danger" variant="flat" size="sm" onPress={handleStop} className="font-medium">
              {t("remotePlay.disconnect")}
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {/* Selector de Modos de Sesión */}
      {isIdle ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Card de Anfitrión */}
          <Card
            isPressable
            onPress={() => setIsHostModalOpen(true)}
            className="bg-default-50/60 dark:bg-default-50/30 hover:bg-default-100/80 border border-default-200/50 dark:border-default-100/10 transition-all hover:border-primary/40 group rounded-2xl shadow-xs overflow-hidden">
            <CardBody className="flex flex-row items-center gap-4 p-5 overflow-hidden">
              <div className="p-3.5 rounded-xl bg-primary/10 text-primary group-hover:scale-105 transition-transform shrink-0">
                <Video size={24} />
              </div>
              <div className="flex flex-col items-start min-w-0">
                <h3 className="text-base font-bold text-foreground group-hover:text-primary transition-colors">
                  {t("remotePlay.host")}
                </h3>
                <p className="text-xs text-default-500 text-left mt-0.5 truncate">{t("remotePlay.hostSubtitle")}</p>
              </div>
            </CardBody>
          </Card>

          {/* Card de Unirse a Juego */}
          <Card
            isPressable
            onPress={() => setIsBrowserOpen(true)}
            className="bg-default-50/60 dark:bg-default-50/30 hover:bg-default-100/80 border border-default-200/50 dark:border-default-100/10 transition-all hover:border-success/40 group rounded-2xl shadow-xs overflow-hidden">
            <CardBody className="flex flex-row items-center gap-4 p-5 overflow-hidden">
              <div className="p-3.5 rounded-xl bg-success/10 text-success group-hover:scale-105 transition-transform shrink-0">
                <Monitor size={24} />
              </div>
              <div className="flex flex-col items-start min-w-0">
                <h3 className="text-base font-bold text-foreground group-hover:text-success transition-colors">
                  {t("remotePlay.join")}
                </h3>
                <p className="text-xs text-default-500 text-left mt-0.5 truncate">{t("remotePlay.joinSubtitle")}</p>
              </div>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {/* Card Principal de Calibración de Transmisión */}
      <Card className="bg-default-50/60 dark:bg-default-50/30 border border-default-200/50 dark:border-default-100/10 rounded-2xl shadow-xs overflow-hidden">
        <CardHeader className="flex items-center justify-between px-6 pt-6 pb-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Sliders size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">{t("remotePlay.settings.title")}</h2>
              <p className="text-xs text-default-500">{t("remotePlay.settings.subtitle")}</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="flat"
            color="primary"
            onPress={handleMirrorConnect}
            className="text-xs font-semibold gap-1.5 border border-primary/20 bg-primary/10 text-primary">
            <Gamepad2 size={15} />
            {t("remotePlay.lanHosts.mirrorHost")}
          </Button>
        </CardHeader>

        <CardBody className="px-6 pb-6 gap-6 overflow-hidden">
          {/* Selector de Presets */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-default-400 uppercase tracking-wider">
              {t("remotePlay.settings.presetTitle")}
            </span>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(["ultra_low_latency", "balanced", "high_fps", "custom"] as StreamingPreset[]).map((p) => {
                const isSelected = config.preset === p;
                return (
                  <Button
                    key={p}
                    size="sm"
                    variant="flat"
                    color={isSelected ? "primary" : "default"}
                    onPress={() => handlePresetSelect(p)}
                    className={`font-medium text-xs ${
                      isSelected
                        ? "bg-primary/20 text-primary-400 border border-primary/30 shadow-xs font-semibold"
                        : "bg-default-100/60 text-default-600 border border-transparent hover:bg-default-200/60"
                    }`}>
                    {t(`remotePlay.settings.presets.${p}`)}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Grid de Resolución y FPS */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Selector de Resolución */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-default-400 uppercase tracking-wider">
                {t("remotePlay.settings.resolution")}
              </span>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(RESOLUTION_OPTIONS) as StreamingResolution[]).map((resKey) => {
                  const item = RESOLUTION_OPTIONS[resKey];
                  const isSelected = config.resolution === resKey;
                  return (
                    <Button
                      key={resKey}
                      size="sm"
                      variant="flat"
                      color={isSelected ? "primary" : "default"}
                      onPress={() => updateConfig((c) => ({ ...c, resolution: resKey, preset: "custom" }))}
                      className={`justify-between px-3 text-xs ${
                        isSelected
                          ? "bg-primary/20 text-primary-400 border border-primary/30 font-bold shadow-xs"
                          : "bg-default-100/60 text-default-600 border border-transparent hover:bg-default-200/60"
                      }`}>
                      <span>{item.label}</span>
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* Selector de FPS */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-default-400 uppercase tracking-wider">
                {t("remotePlay.settings.fps")}
              </span>
              <div className="grid grid-cols-4 gap-2">
                {([30, 60, 90, 120] as StreamingFps[]).map((fpsVal) => {
                  const isSelected = config.fps === fpsVal;
                  return (
                    <Button
                      key={fpsVal}
                      size="sm"
                      variant="flat"
                      color={isSelected ? "primary" : "default"}
                      onPress={() => updateConfig((c) => ({ ...c, fps: fpsVal, preset: "custom" }))}
                      className={`text-xs font-semibold ${
                        isSelected
                          ? "bg-primary/20 text-primary-400 border border-primary/30 shadow-xs"
                          : "bg-default-100/60 text-default-600 border border-transparent hover:bg-default-200/60"
                      }`}>
                      {fpsVal} FPS
                    </Button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Selector de Codificador de Video (H.264, H.265/HEVC, AV1) */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-default-400 uppercase tracking-wider">
              {t("remotePlay.settings.codec")}
            </span>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {CODEC_OPTIONS.map((cOption) => {
                const isSelected = config.codec === cOption.id;
                return (
                  <div
                    key={cOption.id}
                    onClick={() =>
                      updateConfig((c) => ({ ...c, codec: cOption.id as StreamingCodec, preset: "custom" }))
                    }
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between gap-2.5 ${
                      isSelected
                        ? "border-primary/40 bg-primary/10 text-foreground shadow-xs"
                        : "border-default-200/40 dark:border-default-100/10 bg-default-100/40 hover:bg-default-100/80 hover:border-default-200/60"
                    }`}>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-foreground">{cOption.label}</span>
                      <Chip
                        size="sm"
                        variant="flat"
                        color={isSelected ? "primary" : "default"}
                        className="text-[10px] h-5 px-1.5 font-medium">
                        {cOption.badge}
                      </Chip>
                    </div>
                    <p className="text-xs text-default-500 leading-relaxed">{cOption.description}</p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tasa de Bits (Bitrate Slider) */}
          <div className="flex flex-col gap-2 pt-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-default-400 uppercase tracking-wider flex items-center gap-1.5">
                <Zap size={14} className="text-primary" />
                {t("remotePlay.settings.bitrate")}
              </span>
              <span className="font-mono text-sm font-bold text-primary">{config.bitrateMbps} Mbps</span>
            </div>
            <Slider
              size="sm"
              step={5}
              minValue={5}
              maxValue={100}
              aria-label={t("remotePlay.settings.bitrate")}
              value={config.bitrateMbps}
              onChange={(val) => {
                const numVal = Array.isArray(val) ? val[0] : val;
                updateConfig((c) => ({ ...c, bitrateMbps: numVal, preset: "custom" }));
              }}
              color="primary"
              className="max-w-full"
            />
          </div>

          {/* Toggles de Latencia, V-Sync y Audio */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-default-200/40 dark:border-default-100/10">
            <div className="flex items-center justify-between p-3.5 bg-default-100/40 rounded-xl border border-default-200/40 dark:border-default-100/10">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <ShieldCheck size={16} className="text-primary" />
                  {t("remotePlay.settings.lowLatency")}
                </span>
                <span className="text-xs text-default-500">{t("remotePlay.settings.lowLatencyDesc")}</span>
              </div>
              <Switch
                size="sm"
                color="primary"
                isSelected={config.lowLatencyMode}
                onValueChange={(val) => updateConfig((c) => ({ ...c, lowLatencyMode: val, preset: "custom" }))}
              />
            </div>

            <div className="flex items-center justify-between p-3.5 bg-default-100/40 rounded-xl border border-default-200/40 dark:border-default-100/10">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Monitor size={16} className="text-primary" />
                  V-Sync
                </span>
                <span className="text-xs text-default-500">Sincroniza cuadros con tu monitor</span>
              </div>
              <Switch
                size="sm"
                color="primary"
                isSelected={config.enableVsync}
                onValueChange={(val) => updateConfig((c) => ({ ...c, enableVsync: val, preset: "custom" }))}
              />
            </div>

            <div className="flex items-center justify-between p-3.5 bg-default-100/40 rounded-xl border border-default-200/40 dark:border-default-100/10">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Layers size={16} className="text-primary" />
                  {t("remotePlay.settings.audio")}
                </span>
                <span className="text-xs text-default-500">{t("remotePlay.settings.audioDesc")}</span>
              </div>
              <Switch
                size="sm"
                color="primary"
                isSelected={config.audioEnabled}
                onValueChange={(val) => updateConfig((c) => ({ ...c, audioEnabled: val, preset: "custom" }))}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Modales de Control de Conexión */}
      {isHostModalOpen ? <HostSetupModal isOpen={isHostModalOpen} onClose={() => setIsHostModalOpen(false)} /> : null}

      {isBrowserOpen ? (
        <LanHostList isOpen={isBrowserOpen} config={config} onClose={() => setIsBrowserOpen(false)} />
      ) : null}

      {isMirrorConnecting ? (
        <ClientConnectModal
          host={{ ip: "127.0.0.1", hostname: t("remotePlay.lanHosts.mirrorHost"), savecloud_port: 0 }}
          config={config}
          isOpen={true}
          onClose={() => setIsMirrorConnecting(false)}
        />
      ) : null}
    </div>
  );
};
