import type { FastifyRequest } from "fastify";
import type { ResolveCloudStorageScopeUseCase } from "@application/use-cases/ResolveCloudStorageScopeUseCase";
import { ApplicationError } from "@application/errors/ApplicationError";
import type { SteamSeedRepository } from "@domain/ports/SteamSeedRepository";
import { getStorageUserIdFromRequest, ownerIdFromStorageUserId } from "@interfaces/http/helpers/saves-route-helpers";
import { getUserId } from "@interfaces/http/helpers/request-context";

/**
 * Resuelve el catálogo que debe consultar el perfil autenticado.
 *
 * Cuando el bucket contiene un único catálogo con manifiesto, todos los perfiles
 * lo comparten. Si existen varios, se conserva el ámbito propio de cada nube.
 */
export async function resolveSteamSeedCatalogReadOwnerId(
  request: FastifyRequest,
  repository: SteamSeedRepository,
  resolveCloudStorageScopeUseCase?: ResolveCloudStorageScopeUseCase
): Promise<string> {
  const storageUserId = await getStorageUserIdFromRequest(request, resolveCloudStorageScopeUseCase);
  const profileOwnerId = ownerIdFromStorageUserId(storageUserId);
  const catalogOwnerIds = await repository.listCatalogOwnerIds();

  return catalogOwnerIds.length === 1 ? catalogOwnerIds[0]! : profileOwnerId;
}

/**
 * Autoriza escrituras y controles solo al dueño del catálogo activo.
 *
 * Si hay un único catálogo con manifiesto, los demás perfiles pueden leerlo,
 * pero solo su propietario puede publicarlo, pausarlo o reiniciarlo.
 */
export async function requireSteamSeedCatalogWriteOwnerId(
  request: FastifyRequest,
  repository: SteamSeedRepository,
  resolveCloudStorageScopeUseCase?: ResolveCloudStorageScopeUseCase
): Promise<string> {
  const storageUserId = await getStorageUserIdFromRequest(request, resolveCloudStorageScopeUseCase);
  const profileOwnerId = ownerIdFromStorageUserId(storageUserId);
  const catalogOwnerIds = await repository.listCatalogOwnerIds();
  const catalogOwnerId = catalogOwnerIds.length === 1 ? catalogOwnerIds[0]! : profileOwnerId;

  if (profileOwnerId !== catalogOwnerId || getUserId(request) !== catalogOwnerId) {
    throw new ApplicationError("FORBIDDEN", "Solo el propietario del catálogo Steam Seed puede administrarlo.");
  }

  return catalogOwnerId;
}
