import { useCallback, useEffect, useRef, useState } from "react";
import { CONFIG_QUERY_KEY } from "@hooks/useConfig";
import { useProfileSession } from "@hooks/useProfileSession";
import { queryClient } from "@lib/queryClient";
import { useProfileSessionStore } from "@store/ProfileSessionStore";
import {
  createProfileCmd,
  getAlwaysShowSelectorCmd,
  listProfilesCmd,
  deleteProfileCmd,
  setActiveProfileCmd,
} from "@services/tauri/profile.service";
import type { StartupProfileOption } from "@features/profile/ProfileStartupSelector";
import { profileDtoToOption, profileDtoToSession } from "@/app/profileSessionMappers";

export interface CreateProfileInput {
  readonly name: string;
  readonly profileAvatarUrl?: string | null;
}

export interface StartupProfileGateState {
  readonly loading: boolean;
  readonly visible: boolean;
  readonly options: readonly StartupProfileOption[];
  readonly error: string | null;
  readonly selectingId: string | null;
  readonly deletingId: string | null;
  readonly creatingProfile: boolean;
  readonly onSelectProfile: (profileId: string) => Promise<void>;
  readonly onCreateProfile: (input: CreateProfileInput) => Promise<void>;
  readonly onDeleteProfile: (profileId: string) => Promise<void>;
}

export function useStartupProfileGate(): StartupProfileGateState {
  const { activeProfile, loading: sessionLoading } = useProfileSession();
  const startupGateResolvedRef = useRef(false);
  const [screenLoading, setScreenLoading] = useState(true);
  const [screenVisible, setScreenVisible] = useState(false);
  const [options, setOptions] = useState<StartupProfileOption[]>([]);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [creatingProfile, setCreatingProfile] = useState(false);

  useEffect(() => {
    if (sessionLoading) return;

    let cancelled = false;

    const shouldShow = activeProfile === null || !startupGateResolvedRef.current;

    if (shouldShow) {
      const loadStartupGate = async () => {
        setScreenLoading(true);
        setScreenError(null);

        let alwaysShowSelector = false;
        let profileOptions: StartupProfileOption[] = [];

        try {
          const [profiles, alwaysShow] = await Promise.all([listProfilesCmd(), getAlwaysShowSelectorCmd()]);
          profileOptions = profiles.filter((profile) => profile.id.trim().length > 0).map(profileDtoToOption);
          alwaysShowSelector = alwaysShow;
        } catch {
          // Si el sistema de perfiles falla, la app continúa con el perfil default de config.json.
        }

        if (cancelled) return;

        setOptions(profileOptions);
        const mustShow = activeProfile === null || (profileOptions.length > 0 && alwaysShowSelector);

        setScreenVisible(mustShow);
        setScreenLoading(false);
        startupGateResolvedRef.current = true;
      };

      void loadStartupGate();
    } else {
      setScreenVisible(false);
      setScreenLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [sessionLoading, activeProfile]);

  const onSelectProfile = useCallback(
    async (profileId: string) => {
      const selected = options.find((item) => item.id === profileId);
      if (!selected) return;

      setSelectingId(profileId);
      setScreenError(null);

      try {
        if (!profileId.trim()) {
          throw new Error("Perfil invalido: el identificador no puede estar vacio.");
        }

        const updated = await setActiveProfileCmd(profileId);
        queryClient.clear();
        useProfileSessionStore.getState().setActiveProfile(profileDtoToSession(updated), selected.source);

        await queryClient.refetchQueries({ queryKey: CONFIG_QUERY_KEY, type: "all" });
        setScreenVisible(false);
      } catch (error) {
        setScreenError(error instanceof Error ? error.message : String(error));
      } finally {
        setSelectingId(null);
      }
    },
    [options]
  );

  const onCreateProfile = useCallback(async (input: CreateProfileInput) => {
    setScreenError(null);
    setCreatingProfile(true);
    try {
      const created = await createProfileCmd(input);
      const option = profileDtoToOption(created);
      setOptions((prev) => {
        const withoutCreated = prev.filter((item) => item.id !== created.id);
        return [...withoutCreated, option];
      });

      await queryClient.refetchQueries({ queryKey: CONFIG_QUERY_KEY, type: "all" });
    } catch (error) {
      setScreenError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingProfile(false);
    }
  }, []);

  const onDeleteProfile = useCallback(async (profileId: string) => {
    setScreenError(null);
    setDeletingId(profileId);

    try {
      await deleteProfileCmd(profileId);
      setOptions((prev) => prev.filter((item) => item.id !== profileId));
      await queryClient.refetchQueries({ queryKey: CONFIG_QUERY_KEY, type: "all" });
    } catch (error) {
      setScreenError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingId(null);
    }
  }, []);

  return {
    loading: screenLoading,
    visible: screenVisible,
    options,
    error: screenError,
    selectingId,
    deletingId,
    creatingProfile,
    onSelectProfile,
    onCreateProfile,
    onDeleteProfile,
  };
}
