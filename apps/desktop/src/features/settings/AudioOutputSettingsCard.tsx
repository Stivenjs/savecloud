/**
 * @file AudioOutputSettingsCard.tsx
 * @description Tarjeta de configuración para la selección multiplataforma del dispositivo de salida de sonido con TanStack Query.
 */

import { useMemo } from "react";
import { Card, CardBody, Select, SelectItem } from "@heroui/react";
import { Volume2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toastError, toastSuccess } from "@utils/toast";

export interface AudioOutputDeviceItem {
  name: string;
  is_default: boolean;
}

interface SelectOption {
  key: string;
  label: string;
}

const AUDIO_OUTPUT_QUERY_KEYS = {
  devices: ["audio-output-devices"] as const,
  active: ["audio-output-device-active"] as const,
};

async function fetchAudioOutputDevices(): Promise<AudioOutputDeviceItem[]> {
  const list = await invoke<AudioOutputDeviceItem[]>("list_audio_output_devices");
  return list ?? [];
}

async function fetchActiveAudioOutputDevice(): Promise<string> {
  const active = await invoke<string | null>("get_audio_output_device");
  return active || "default";
}

async function setAudioOutputDevice(key: string): Promise<string> {
  const deviceName = key === "default" ? null : key;
  await invoke("set_audio_output_device", { deviceName });
  return key;
}

export function AudioOutputSettingsCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data: devices = [], isLoading: loadingDevices } = useQuery({
    queryKey: AUDIO_OUTPUT_QUERY_KEYS.devices,
    queryFn: fetchAudioOutputDevices,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: selectedDevice = "default", isLoading: loadingActive } = useQuery({
    queryKey: AUDIO_OUTPUT_QUERY_KEYS.active,
    queryFn: fetchActiveAudioOutputDevice,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { mutate: handleChangeDevice, isPending: updating } = useMutation({
    mutationFn: setAudioOutputDevice,
    onMutate: async (newKey: string) => {
      await queryClient.cancelQueries({ queryKey: AUDIO_OUTPUT_QUERY_KEYS.active });
      const previous = queryClient.getQueryData<string>(AUDIO_OUTPUT_QUERY_KEYS.active);
      queryClient.setQueryData<string>(AUDIO_OUTPUT_QUERY_KEYS.active, newKey);
      return { previous };
    },
    onSuccess: () => {
      toastSuccess(t("settings.audioOutput.deviceUpdated", "Dispositivo de sonido actualizado correctamente"));
    },
    onError: (e, _newKey, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(AUDIO_OUTPUT_QUERY_KEYS.active, context.previous);
      }
      toastError(
        e instanceof Error
          ? e.message
          : t("settings.audioOutput.deviceUpdateError", "Error al cambiar dispositivo de sonido")
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: AUDIO_OUTPUT_QUERY_KEYS.active });
    },
  });

  const loading = loadingDevices || loadingActive || updating;

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
            onChange={(e) => {
              if (e.target.value) {
                handleChangeDevice(e.target.value);
              }
            }}
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
