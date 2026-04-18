import { useCallback, useEffect, useRef, useState } from "react";
import { CONFIG_QUERY_KEY } from "@hooks/useConfig";
import { useProfileSession } from "@hooks/useProfileSession";
import { queryClient } from "@lib/queryClient";
import { useProfileSessionStore } from "@store/ProfileSessionStore";
import {
  createProfileCmd,
  getAlwaysShowSelectorCmd,
  listProfilesCmd,
  setActiveProfileCmd,
} from "@services/tauri/profile.service";
import type { StartupProfileOption } from "@features/profile/ProfileStartupSelector";
import { profileDtoToOption, profileDtoToSession } from "@/app/profileSessionMappers";

export interface CreateProfileInput {
  readonly name: string;
}

export interface StartupProfileGateState {
  readonly loading: boolean;
  readonly visible: boolean;
  readonly options: readonly StartupProfileOption[];
  readonly error: string | null;
  readonly selectingId: string | null;
  readonly creatingProfile: boolean;
  readonly onSelectProfile: (profileId: string) => Promise<void>;
  readonly onCreateProfile: (input: CreateProfileInput) => Promise<void>;
}

export function useStartupProfileGate(): StartupProfileGateState {
  const { loading: sessionLoading } = useProfileSession();
  const startupGateResolvedRef = useRef(false);
  const [screenLoading, setScreenLoading] = useState(true);
  const [screenVisible, setScreenVisible] = useState(false);
  const [options, setOptions] = useState<StartupProfileOption[]>([]);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [creatingProfile, setCreatingProfile] = useState(false);

  useEffect(() => {
    if (sessionLoading || startupGateResolvedRef.current) return;

    let cancelled = false;

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
      const shouldShowSelector = profileOptions.length > 0 && alwaysShowSelector;
      setScreenVisible(shouldShowSelector);
      setScreenLoading(false);
      startupGateResolvedRef.current = true;
    };

    void loadStartupGate();

    return () => {
      cancelled = true;
    };
  }, [sessionLoading]);

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

  return {
    loading: screenLoading,
    visible: screenVisible,
    options,
    error: screenError,
    selectingId,
    creatingProfile,
    onSelectProfile,
    onCreateProfile,
  };
}
