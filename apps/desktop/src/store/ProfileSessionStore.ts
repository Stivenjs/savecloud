import { create } from "zustand";
import type { Config } from "@app-types/config";
import { queryClient } from "@lib/queryClient";
import { getConfig } from "@services/tauri/config.service";
import { getActiveProfileCmd } from "@services/tauri/profile.service";
import { CONFIG_QUERY_KEY } from "@hooks/useConfig";

export type ProfileSessionSource = "config-default" | "profiles-api";

export interface ActiveProfileSession {
  readonly id: string;
  readonly name: string;
  readonly localUserId: string;
  readonly apiBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly profileAvatarUrl: string | null;
  /** Preferencia del perfil activo en disco (`developer_mode` en settings del perfil). */
  readonly developerMode: boolean;
}

interface ProfileSessionStore {
  loading: boolean;
  activeProfile: ActiveProfileSession | null;
  source: ProfileSessionSource | null;
  error: string | null;
  hydrateSession: () => Promise<void>;
  setActiveProfile: (profile: ActiveProfileSession, source: ProfileSessionSource) => void;
  patchSession: (partial: Partial<Pick<ActiveProfileSession, "developerMode">>) => void;
  clearSession: () => void;
  clearError: () => void;
}

let hydrationPromise: Promise<void> | null = null;

function toDefaultProfile(config: Config): ActiveProfileSession {
  return {
    id: "default-config-profile",
    name: "Default",
    localUserId: config.userId?.trim() ?? "",
    apiBaseUrl: config.apiBaseUrl?.trim() ?? "",
    wsBaseUrl: config.wsBaseUrl?.trim() ?? "",
    profileAvatarUrl: config.profileAvatar?.trim() || null,
    developerMode: Boolean(config.developerMode),
  };
}

export const useProfileSessionStore = create<ProfileSessionStore>((set) => ({
  loading: true,
  activeProfile: null,
  source: null,
  error: null,

  hydrateSession: async () => {
    if (hydrationPromise) return hydrationPromise;

    hydrationPromise = (async () => {
      set({ loading: true, error: null });

      try {
        const cachedConfig = queryClient.getQueryData<Config>(CONFIG_QUERY_KEY);
        const configPromise =
          cachedConfig != null
            ? Promise.resolve(cachedConfig)
            : queryClient.fetchQuery({
                queryKey: CONFIG_QUERY_KEY,
                queryFn: getConfig,
                staleTime: 10 * 60 * 1000,
              });

        const activeProfilePromise = getActiveProfileCmd();
        const config = await configPromise;
        const fallbackProfile = toDefaultProfile(config);

        let nextProfile: ActiveProfileSession = fallbackProfile;
        let nextSource: ProfileSessionSource = "config-default";

        try {
          const activeProfile = await activeProfilePromise;
          nextProfile = {
            id: activeProfile.id,
            name: activeProfile.name,
            localUserId: activeProfile.localUserId,
            apiBaseUrl: activeProfile.apiBaseUrl,
            wsBaseUrl: activeProfile.wsBaseUrl,
            profileAvatarUrl: activeProfile.profileAvatarUrl ?? fallbackProfile.profileAvatarUrl,
            developerMode: Boolean(activeProfile.developerMode),
          };
          nextSource = "profiles-api";
        } catch {
          // Si falla el comando de perfiles, mantenemos perfil default de config.json.
        }

        set({
          activeProfile: nextProfile,
          source: nextSource,
          loading: false,
          error: null,
        });
      } catch (error) {
        set({
          loading: false,
          activeProfile: null,
          source: null,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        hydrationPromise = null;
      }
    })();

    return hydrationPromise;
  },

  setActiveProfile: (profile, source) => {
    set({ activeProfile: profile, source, error: null });
  },

  patchSession: (partial) =>
    set((s) => ({
      activeProfile: s.activeProfile ? { ...s.activeProfile, ...partial } : null,
    })),

  clearSession: () => set({ activeProfile: null, source: null, error: null }),

  clearError: () => set({ error: null }),
}));
