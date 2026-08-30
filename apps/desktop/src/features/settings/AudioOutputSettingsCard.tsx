/**
 * @file AudioOutputSettingsCard.tsx
 * @description Tarjeta de configuración para la selección multiplataforma del dispositivo de salida de sonido.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { Card, CardBody, Select, SelectItem } from "@heroui/react";
import { Volume2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { toastError, toastSuccess } from "@utils/toast";

export interface AudioOutputDeviceItem {
  name: string;
  is_default: boolean;
}

interface SelectOption {
  key: string;
  label: string;
}

export function AudioOutputSettingsCard() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<AudioOutputDeviceItem[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>("default");
  const [loading, setLoading] = useState<boolean>(true);

  const loadAudioDevices = useCallback(async () => {
    try {
      setLoading(true);
      const list = await invoke<AudioOutputDeviceItem[]>("list_audio_output_devices");
      const active = await invoke<string | null>("get_audio_output_device");

      setDevices(list || []);
      setSelectedDevice(active || "default");
    } catch (e) {
      console.error("[AudioSettings] Error al cargar dispositivos de sonido:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAudioDevices();
  }, [loadAudioDevices]);

  const handleChange = async (key: string) => {
    try {
      const deviceName = key === "default" ? null : key;
      await invoke("set_audio_output_device", { deviceName });
      setSelectedDevice(key);
      toastSuccess(t("settings.audioOutput.deviceUpdated", "Dispositivo de sonido actualizado correctamente"));
    } catch (e) {
      toastError(
        e instanceof Error
          ? e.message
          : t("settings.audioOutput.deviceUpdateError", "Error al cambiar dispositivo de sonido")
      );
    }
  };

  const selectOptions: SelectOption[] = useMemo(() => {
    const defaultSuffix = t("settings.audioOutput.defaultSuffix", " (Predeterminado)");
    const options: SelectOption[] = [
      { key: "default", label: t("settings.audioOutput.systemDefault", "Por defecto del sistema") },
    ];
    for (const dev of devices) {
      options.push({
        key: dev.name,
        label: `${dev.name}${dev.is_default ? defaultSuffix : ""}`,
      });
    }
    return options;
  }, [devices, t]);

  return (
    <Card>
      <CardBody className="gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Volume2 size={20} className="mt-0.5 shrink-0 text-default-500" />
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {t("settings.audioOutput.title", "Dispositivo de salida de sonido")}
              </h2>
              <p className="mt-0.5 text-sm text-default-500">
                {t(
                  "settings.audioOutput.description",
                  "Selecciona los altavoces, auriculares o salida de audio física para la reproducción de sonido en tiempo real."
                )}
              </p>
            </div>
          </div>
          <Select
            aria-label={t("settings.audioOutput.title", "Dispositivo de salida de sonido")}
            items={selectOptions}
            selectedKeys={[selectedDevice]}
            isDisabled={loading}
            onChange={(e) => handleChange(e.target.value)}
            className="w-full sm:max-w-65"
            disallowEmptySelection
            size="sm">
            {(item) => (
              <SelectItem key={item.key} textValue={item.label}>
                {item.label}
              </SelectItem>
            )}
          </Select>
        </div>
      </CardBody>
    </Card>
  );
}
