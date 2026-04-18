import { invoke } from "@tauri-apps/api/core";

export interface ProfileDto {
  readonly id: string;
  readonly name: string;
  readonly localUserId: string;
  readonly apiBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly profileAvatarUrl?: string | null;
  readonly createdAt: number;
  readonly lastUsed: number;
  readonly cloudHostCount: number;
}

export interface CreateProfileInput {
  readonly name: string;
}

export async function listProfilesCmd(): Promise<ProfileDto[]> {
  return invoke<ProfileDto[]>("list_profiles_cmd");
}

export async function getActiveProfileCmd(): Promise<ProfileDto> {
  return invoke<ProfileDto>("get_active_profile_cmd");
}

export async function setActiveProfileCmd(profileId: string): Promise<ProfileDto> {
  return invoke<ProfileDto>("set_active_profile_cmd", { profileId });
}

export async function createProfileCmd(input: CreateProfileInput): Promise<ProfileDto> {
  return invoke<ProfileDto>("create_profile_cmd", {
    name: input.name,
  });
}

export async function deleteProfileCmd(profileId: string): Promise<void> {
  await invoke("delete_profile_cmd", { profileId });
}

export async function getAlwaysShowSelectorCmd(): Promise<boolean> {
  return invoke<boolean>("get_always_show_selector_cmd");
}

export async function setAlwaysShowSelectorCmd(alwaysShow: boolean): Promise<void> {
  await invoke("set_always_show_selector_cmd", { alwaysShow });
}
