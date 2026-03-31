import { invoke } from "@tauri-apps/api/core";

export interface CloudInvite {
  id: string;
  hostUserId: string;
  inviteeUserId?: string | null;
  token?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface CloudMembership {
  hostUserId: string;
  memberUserId: string;
  invitedById: string;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

export interface CloudMembershipsResponse {
  hostMemberships: CloudMembership[];
  memberMemberships: CloudMembership[];
}

export async function createCloudInvite(input: {
  inviteeUserId?: string;
  withToken?: boolean;
  expiresInDays?: number;
}): Promise<CloudInvite> {
  const inviteeUserId = input.inviteeUserId?.trim();
  const payload: {
    inviteeUserId?: string;
    withToken: boolean;
    expiresInDays: number;
  } = {
    withToken: input.withToken ?? true,
    expiresInDays: input.expiresInDays ?? 7,
  };
  if (inviteeUserId) {
    payload.inviteeUserId = inviteeUserId;
  }
  return invoke<CloudInvite>("create_cloud_invite", {
    ...payload,
  });
}

export async function listPendingCloudInvites(): Promise<CloudInvite[]> {
  return invoke<CloudInvite[]>("list_pending_cloud_invites");
}

export async function respondCloudInvite(inviteId: string, action: "accept" | "reject"): Promise<void> {
  await invoke("respond_cloud_invite", { inviteId, action });
}

export async function acceptCloudInviteByToken(token: string): Promise<void> {
  await invoke("accept_cloud_invite_by_token", { token });
}

export async function leaveCloudMembership(hostUserId: string): Promise<void> {
  await invoke("leave_cloud_membership", { hostUserId });
}

export async function removeCloudMember(memberUserId: string): Promise<void> {
  await invoke("remove_cloud_member", { memberUserId });
}

export async function listCloudMemberships(): Promise<CloudMembershipsResponse> {
  return invoke<CloudMembershipsResponse>("list_cloud_memberships");
}
