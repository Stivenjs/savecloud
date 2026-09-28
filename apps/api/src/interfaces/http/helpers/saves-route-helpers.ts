import type { FastifyRequest } from "fastify";
import type { ResolveCloudStorageScopeUseCase } from "@application/use-cases/ResolveCloudStorageScopeUseCase";
import { getUserId } from "@interfaces/http/helpers/request-context";

const CLOUD_HOST_HEADER = "x-cloud-host-user-id";

export async function getStorageUserIdFromRequest(
  request: FastifyRequest,
  resolveCloudStorageScopeUseCase?: ResolveCloudStorageScopeUseCase
): Promise<string> {
  const requesterUserId = getUserId(request);
  const hostHeader = request.headers[CLOUD_HOST_HEADER];
  const requestedHostUserId = typeof hostHeader === "string" && hostHeader.trim() ? hostHeader.trim() : undefined;
  if (!resolveCloudStorageScopeUseCase) return requesterUserId;
  const scope = await resolveCloudStorageScopeUseCase.execute(requesterUserId, requestedHostUserId);
  return scope.storageUserId;
}

export function ownerIdFromStorageUserId(storageUserId: string): string {
  const marker = "::member::";
  const idx = storageUserId.indexOf(marker);
  return idx > 0 ? storageUserId.slice(0, idx) : storageUserId;
}
