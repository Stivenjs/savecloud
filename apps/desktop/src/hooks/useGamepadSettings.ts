/**
 * @file useGamepadSettings.ts
 * @description Hook de TanStack Query para gestionar el comportamiento del mando en segundo plano.
 * Cumple con vercel-react-best-practices: sin useEffect, con mutaciones tipadas y cacheo reactivo.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getGamepadIgnoreBackground, setGamepadIgnoreBackground } from "@services/tauri";
import { CONFIG_QUERY_KEY } from "@hooks/useConfig";

export const GAMEPAD_SETTINGS_QUERY_KEY = ["gamepad-settings"] as const;

export function useGamepadSettings() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: GAMEPAD_SETTINGS_QUERY_KEY,
    queryFn: async () => {
      return getGamepadIgnoreBackground();
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (ignore: boolean) => {
      await setGamepadIgnoreBackground(ignore);
    },
    onMutate: async (newIgnore: boolean) => {
      await queryClient.cancelQueries({ queryKey: GAMEPAD_SETTINGS_QUERY_KEY });
      const previousValue = queryClient.getQueryData<boolean>(GAMEPAD_SETTINGS_QUERY_KEY);
      queryClient.setQueryData<boolean>(GAMEPAD_SETTINGS_QUERY_KEY, newIgnore);
      return { previousValue };
    },
    onError: (_err, _newIgnore, context) => {
      if (context?.previousValue !== undefined) {
        queryClient.setQueryData<boolean>(GAMEPAD_SETTINGS_QUERY_KEY, context.previousValue);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: GAMEPAD_SETTINGS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    },
  });

  return {
    ignoreBackground: query.data ?? true,
    isLoading: query.isLoading,
    isSaving: mutation.isPending,
    setIgnoreBackground: mutation.mutate,
  };
}
