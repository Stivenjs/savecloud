/**
 * @file useOverlaySoundSettings.ts
 * @description Hook de TanStack Query para gestionar la configuración del overlay (sonido, volumen y posición).
 * Cumple con vercel-react-best-practices: sin useEffect, mutaciones optimistas con rollback y sync cross-window.
 */

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getOverlaySettings,
  setOverlaySettings,
  setOverlaySoundSettings,
  setOverlayPosition,
  type OverlaySettings,
  type OverlaySoundSettings,
  type OverlayPosition,
} from "@services/tauri";
import { listen } from "@tauri-apps/api/event";
import { queryClient } from "@lib/queryClient";

export const OVERLAY_SETTINGS_QUERY_KEYS = {
  all: ["overlay-settings"] as const,
};

let isOverlayListenerRegistered = false;

function registerOverlayListeners() {
  if (isOverlayListenerRegistered) return;
  isOverlayListenerRegistered = true;

  void listen<OverlaySettings>("overlay-settings-changed", (event) => {
    if (event.payload) {
      queryClient.setQueryData<OverlaySettings>(
        OVERLAY_SETTINGS_QUERY_KEYS.all,
        (prev: OverlaySettings | undefined) => {
          if (
            prev &&
            prev.enabled === event.payload.enabled &&
            prev.volume === event.payload.volume &&
            prev.position === event.payload.position
          ) {
            return prev;
          }
          return event.payload;
        }
      );
    }
  });

  void listen<OverlaySoundSettings>("overlay-sound-settings-changed", (event) => {
    if (event.payload) {
      queryClient.setQueryData<OverlaySettings>(
        OVERLAY_SETTINGS_QUERY_KEYS.all,
        (prev: OverlaySettings | undefined) => {
          if (!prev) return undefined;
          if (prev.enabled === event.payload.enabled && prev.volume === event.payload.volume) {
            return prev;
          }
          return {
            ...prev,
            enabled: event.payload.enabled,
            volume: event.payload.volume,
          };
        }
      );
    }
  });

  void listen<OverlayPosition>("overlay-position-changed", (event) => {
    if (event.payload) {
      queryClient.setQueryData<OverlaySettings>(
        OVERLAY_SETTINGS_QUERY_KEYS.all,
        (prev: OverlaySettings | undefined) => {
          if (!prev) return undefined;
          if (prev.position === event.payload) {
            return prev;
          }
          return {
            ...prev,
            position: event.payload,
          };
        }
      );
    }
  });
}

// Auto-registrar listeners de eventos cross-window de Tauri
registerOverlayListeners();

export function useOverlaySoundSettings() {
  const qc = useQueryClient();

  const {
    data: settings = { enabled: true, volume: 0.6, position: "bottom-right" },
    isLoading,
    refetch,
  } = useQuery({
    queryKey: OVERLAY_SETTINGS_QUERY_KEYS.all,
    queryFn: getOverlaySettings,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const soundSettings = useMemo(
    () => ({ enabled: settings.enabled, volume: settings.volume }),
    [settings.enabled, settings.volume]
  );

  const updateSoundMutation = useMutation({
    mutationFn: setOverlaySoundSettings,
    onMutate: async (newSound: OverlaySoundSettings) => {
      await qc.cancelQueries({ queryKey: OVERLAY_SETTINGS_QUERY_KEYS.all });
      const previous = qc.getQueryData<OverlaySettings>(OVERLAY_SETTINGS_QUERY_KEYS.all);
      if (previous) {
        qc.setQueryData<OverlaySettings>(OVERLAY_SETTINGS_QUERY_KEYS.all, {
          ...previous,
          enabled: newSound.enabled,
          volume: newSound.volume,
        });
      }
      return { previous };
    },
    onError: (_err, _newSound, context) => {
      if (context?.previous) {
        qc.setQueryData<OverlaySettings>(OVERLAY_SETTINGS_QUERY_KEYS.all, context.previous);
      }
    },
  });

  const updatePositionMutation = useMutation({
    mutationFn: setOverlayPosition,
    onMutate: async (newPosition: OverlayPosition) => {
      await qc.cancelQueries({ queryKey: OVERLAY_SETTINGS_QUERY_KEYS.all });
      const previous = qc.getQueryData<OverlaySettings>(OVERLAY_SETTINGS_QUERY_KEYS.all);
      if (previous) {
        qc.setQueryData<OverlaySettings>(OVERLAY_SETTINGS_QUERY_KEYS.all, {
          ...previous,
          position: newPosition,
        });
      }
      return { previous };
    },
    onError: (_err, _newPosition, context) => {
      if (context?.previous) {
        qc.setQueryData<OverlaySettings>(OVERLAY_SETTINGS_QUERY_KEYS.all, context.previous);
      }
    },
  });

  const updateAllMutation = useMutation({
    mutationFn: setOverlaySettings,
    onMutate: async (newSettings: OverlaySettings) => {
      await qc.cancelQueries({ queryKey: OVERLAY_SETTINGS_QUERY_KEYS.all });
      const previous = qc.getQueryData<OverlaySettings>(OVERLAY_SETTINGS_QUERY_KEYS.all);
      qc.setQueryData<OverlaySettings>(OVERLAY_SETTINGS_QUERY_KEYS.all, newSettings);
      return { previous };
    },
    onError: (_err, _newSettings, context) => {
      if (context?.previous) {
        qc.setQueryData<OverlaySettings>(OVERLAY_SETTINGS_QUERY_KEYS.all, context.previous);
      }
    },
  });

  const isSavingSound = updateSoundMutation.isPending;
  const isSavingPosition = updatePositionMutation.isPending;
  const isSaving = isSavingSound || isSavingPosition || updateAllMutation.isPending;

  return {
    settings,
    soundSettings,
    position: settings.position,
    isLoading,
    isSavingSound,
    isSavingPosition,
    isSaving,
    updateSettings: updateSoundMutation.mutate,
    updatePosition: updatePositionMutation.mutate,
    updateAllSettings: updateAllMutation.mutate,
    refetch,
  };
}

export const useOverlaySettings = useOverlaySoundSettings;
