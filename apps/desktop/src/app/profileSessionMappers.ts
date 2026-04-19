import type { Config } from "@app-types/config";
import type { StartupProfileOption } from "@features/profile/ProfileStartupSelector";
import type { ProfileDto } from "@services/tauri/profile.service";
import type { ActiveProfileSession } from "@store/ProfileSessionStore";
import { DEFAULT_PROFILE_ID } from "@/app/constants";

export function profileDtoToOption(profile: ProfileDto): StartupProfileOption {
  return {
    id: profile.id,
    name: profile.name,
    localUserId: profile.localUserId,
    profileAvatarUrl: profile.profileAvatarUrl ?? null,
    source: profile.id === DEFAULT_PROFILE_ID ? "config-default" : "profiles-api",
  };
}

export function profileDtoToSession(profile: ProfileDto): ActiveProfileSession {
  return {
    id: profile.id,
    name: profile.name,
    localUserId: profile.localUserId,
    apiBaseUrl: profile.apiBaseUrl,
    wsBaseUrl: profile.wsBaseUrl,
    profileAvatarUrl: profile.profileAvatarUrl ?? null,
  };
}

export function configDefaultToSession(config: Config | null | undefined): ActiveProfileSession {
  return {
    id: "default-config-profile",
    name: "Default",
    localUserId: config?.userId?.trim() ?? "",
    apiBaseUrl: config?.apiBaseUrl?.trim() ?? "",
    wsBaseUrl: config?.wsBaseUrl?.trim() ?? "",
    profileAvatarUrl: config?.profileAvatar?.trim() || null,
  };
}
