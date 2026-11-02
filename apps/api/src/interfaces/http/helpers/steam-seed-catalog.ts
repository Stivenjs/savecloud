import type { FastifyRequest } from "fastify";
import type { ResolveCloudStorageScopeUseCase } from "@application/use-cases/ResolveCloudStorageScopeUseCase";
import { ApplicationError } from "@application/errors/ApplicationError";
import type { SteamSeedRepository } from "@domain/ports/SteamSeedRepository";
import { getStorageUserIdFromRequest, ownerIdFromStorageUserId } from "@interfaces/http/helpers/saves-route-helpers";
import { getUserId } from "@interfaces/http/helpers/request-context";
import { TtlCache } from "@shared/ttlCache";

const CATALOG_OWNER_CACHE_TTL_MS = 60_000;
const CATALOG_OWNER_CACHE_MAX_ENTRIES = 20;

const catalogOwnerIdsCache = new TtlCache<string, string[]>({
  ttlMs: CATALOG_OWNER_CACHE_TTL_MS,
  maxEntries: CATALOG_OWNER_CACHE_MAX_ENTRIES,
});
const catalogOwnerIdsInFlight = new Map<string, { promise: Promise<string[]>; invalidated: boolean }>();

function getSteamSeedPrefix(): string {
  return (process.env.STEAM_SEED_PREFIX ?? "steam-seed").replace(/^\/+|\/+$/g, "");
}

function getCatalogOwnerCacheKey(): string {
  const bucketName = process.env.BUCKET_NAME?.trim() || "savecloud-saves-dev";
  return `${bucketName}::${getSteamSeedPrefix()}`;
}

async function getCatalogOwnerIds(repository: SteamSeedRepository): Promise<string[]> {
  const cacheKey = getCatalogOwnerCacheKey();
  const cached = catalogOwnerIdsCache.get(cacheKey);
  if (cached) return cached;

  const pending = catalogOwnerIdsInFlight.get(cacheKey);
  if (pending) return pending.promise;

  const request = { promise: Promise.resolve([] as string[]), invalidated: false };
  request.promise = Promise.resolve().then(() => repository.listCatalogOwnerIds());
  catalogOwnerIdsInFlight.set(cacheKey, request);

  try {
    const ownerIds = await request.promise;
    if (!request.invalidated) catalogOwnerIdsCache.set(cacheKey, ownerIds);
    return ownerIds;
  } finally {
    if (catalogOwnerIdsInFlight.get(cacheKey) === request) {
      catalogOwnerIdsInFlight.delete(cacheKey);
    }
  }
}

/**
 * Determina si una clave pertenece al catálogo Steam Seed configurado.
 *
 * @param s3Key - Clave del objeto recibida desde el evento de almacenamiento.
 * @returns `true` cuando la clave pertenece al prefijo del catálogo.
 */
export function isSteamSeedCatalogKey(s3Key: string): boolean {
  const prefix = getSteamSeedPrefix();
  return s3Key === prefix || s3Key.startsWith(`${prefix}/`);
}

/**
 * Invalida la resolución cacheada de propietarios del catálogo Steam Seed.
 *
 * La invalidación se ejecuta después de procesar eventos de almacenamiento para
 * que la siguiente request consulte el estado actualizado del catálogo.
 */
export function invalidateSteamSeedCatalogOwnerCache(): void {
  const cacheKey = getCatalogOwnerCacheKey();
  catalogOwnerIdsCache.delete(cacheKey);
  const pending = catalogOwnerIdsInFlight.get(cacheKey);
  if (pending) pending.invalidated = true;
}

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
  const catalogOwnerIds = await getCatalogOwnerIds(repository);

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
  const catalogOwnerIds = await getCatalogOwnerIds(repository);
  const catalogOwnerId = catalogOwnerIds.length === 1 ? catalogOwnerIds[0]! : profileOwnerId;

  if (profileOwnerId !== catalogOwnerId || getUserId(request) !== catalogOwnerId) {
    throw new ApplicationError("FORBIDDEN", "Solo el propietario del catálogo Steam Seed puede administrarlo.");
  }

  return catalogOwnerId;
}
