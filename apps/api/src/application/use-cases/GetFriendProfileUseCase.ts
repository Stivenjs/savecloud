import type { SaveRepository } from "@domain/ports/SaveRepository";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { ResolveCloudStorageScopeUseCase } from "./ResolveCloudStorageScopeUseCase";

/**
 * DTO que representa el perfil compartido de un amigo.
 */
export interface FriendProfileDto {
  userId: string;
  totalPlaytime: number;
  profileBackground: string | null;
  profileAvatar: string | null;
  profileFrame: string | null;
  shareVisualProfileWithHosts: boolean;
  shareVisualProfileWithMembers: boolean;
  games: Array<{
    id: string;
    steamAppId?: string;
    imageUrl?: string;
    editionLabel?: string;
    playtimeSeconds: number;
    paths: string[];
    sourceUrl?: string;
  }>;
}

/**
 * Caso de uso para recuperar y procesar el perfil de otro usuario.
 * * Orquesta la búsqueda del archivo config.json, resuelve el ámbito de almacenamiento
 * para invitados y normaliza los datos para asegurar compatibilidad entre formatos.
 */
export class GetFriendProfileUseCase {
  /**
   * @param saveRepository Puerto para operaciones de archivos en la nube.
   * @param inviteRepository Puerto para validar relaciones entre usuarios.
   * @param resolveScope Caso de uso para determinar el prefijo de almacenamiento (Storage ID).
   */
  constructor(
    private readonly saveRepository: SaveRepository,
    private readonly inviteRepository: CloudInviteRepository,
    private readonly resolveScope: ResolveCloudStorageScopeUseCase
  ) {}

  /**
   * Ejecuta la lógica de obtención, normalización y filtrado de privacidad.
   * @param requesterUserId ID del usuario que solicita la información.
   * @param targetUserId ID del usuario cuyo perfil se quiere visualizar.
   * @returns El perfil procesado y normalizado.
   */
  async execute(requesterUserId: string, targetUserId: string): Promise<FriendProfileDto> {
    const allUsers = await this.saveRepository.listAllUsers();

    const realTargetUserId = this.findClosestUser(targetUserId, allUsers);

    if (!realTargetUserId) {
      throw new Error("User does not have any config saved in the cloud.");
    }

    const storageUserId = await this.resolveStorageUserId(realTargetUserId);

    const saves = await this.saveRepository.listByUserAndGame(storageUserId, "__config__");

    if (!saves || saves.length === 0) {
      throw new Error("User does not have any config saved in the cloud.");
    }

    const latestConfig = saves
      .filter((s) => s.filename.endsWith("config.json"))
      .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())[0];

    if (!latestConfig) {
      throw new Error("User does not have any config saved in the cloud.");
    }

    const jsonString = await this.saveRepository.getFileContent(latestConfig.key);

    /**
     * Normalizamos el objeto crudo apenas se parsea.
     * Esto limpia el código de aquí en adelante.
     */
    const data = this.normalizeConfig(JSON.parse(jsonString));

    const allowVisual = await this.checkPrivacyPermissions(requesterUserId, realTargetUserId, data);

    const totalPlaytime = data.games.reduce(
      (sum: number, g: { playtimeSeconds?: number }) => sum + (g.playtimeSeconds ?? 0),
      0
    );

    return {
      userId: realTargetUserId,
      totalPlaytime,
      profileBackground: allowVisual ? data.profileBackground : null,
      profileAvatar: allowVisual ? data.profileAvatar : null,
      profileFrame: allowVisual ? data.profileFrame : null,
      shareVisualProfileWithHosts: data.shareVisualProfileWithHosts,
      shareVisualProfileWithMembers: data.shareVisualProfileWithMembers,
      games: data.games.map((g: { playtimeSeconds: number; paths: string[] }) => ({
        ...g,
        playtimeSeconds: g.playtimeSeconds ?? 0,
        paths: g.paths ?? [],
      })),
    };
  }

  /**
   * Lógica avanzada a prueba de errores: Ignora prefijos de S3, perdona mayúsculas,
   * espacios, nombres incompletos Y errores de ortografía o tipeo (Levenshtein).
   */
  private findClosestUser(target: string, availableS3Folders: string[]): string | null {
    const cleanTarget = target.trim().toLowerCase();
    if (!cleanTarget) return null;

    const mappedUsers = availableS3Folders.map((folder) => {
      const realName = folder.split("::member::").pop() || folder;
      return {
        realName,
        searchableName: realName.toLowerCase(),
      };
    });

    const exactMatch = mappedUsers.find((u) => u.searchableName === cleanTarget);
    if (exactMatch) return exactMatch.realName;

    const partialMatch = mappedUsers.find((u) => u.searchableName.includes(cleanTarget));
    if (partialMatch) return partialMatch.realName;

    let bestMatch = null;
    let lowestDistance = Infinity;
    const maxErrors = cleanTarget.length <= 4 ? 1 : 2;

    for (const u of mappedUsers) {
      const distance = this.levenshteinDistance(cleanTarget, u.searchableName);

      if (distance <= maxErrors && distance < lowestDistance) {
        lowestDistance = distance;
        bestMatch = u.realName;
      }
    }

    return bestMatch;
  }

  /**
   * Calcula matemáticamente los errores ortográficos entre dos textos (Distancia de Levenshtein).
   * Determina cuántas letras hay que insertar, eliminar o sustituir para que 'a' sea igual a 'b'.
   * @private
   */
  private levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix = Array(b.length + 1)
      .fill(null)
      .map(() => Array(a.length + 1).fill(null));

    for (let i = 0; i <= a.length; i += 1) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j += 1) matrix[j][0] = j;

    for (let j = 1; j <= b.length; j += 1) {
      for (let i = 1; i <= a.length; i += 1) {
        const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // inserción
          matrix[j - 1][i] + 1, // eliminación
          matrix[j - 1][i - 1] + indicator // sustitución
        );
      }
    }
    return matrix[b.length][a.length];
  }

  /**
   * Centraliza la compatibilidad entre snake_case (Rust) y camelCase (TS).
   * @param raw Objeto JSON crudo descargado de S3.
   * @private
   */
  private normalizeConfig(raw: any) {
    return {
      profileBackground: raw.profile_background ?? raw.profileBackground ?? null,
      profileAvatar: raw.profile_avatar ?? raw.profileAvatar ?? null,
      profileFrame: raw.profile_frame ?? raw.profileFrame ?? null,
      shareVisualProfileWithHosts: !!(raw.share_visual_profile_with_hosts ?? raw.shareVisualProfileWithHosts),
      shareVisualProfileWithMembers: !!(raw.share_visual_profile_with_members ?? raw.shareVisualProfileWithMembers),
      games: (raw.games || []).map((g: any) => ({
        id: g.id,
        steamAppId: g.steam_app_id ?? g.steamAppId ?? null,
        imageUrl: g.image_url ?? g.imageUrl ?? null,
        editionLabel: g.edition_label ?? g.editionLabel ?? null,
        playtimeSeconds: g.playtime_seconds ?? g.playtimeSeconds ?? 0,
        paths: g.paths ?? [],
        sourceUrl: g.source_url ?? g.sourceUrl ?? null,
      })),
    };
  }

  /**
   * Determina el ID de almacenamiento correcto si el usuario es un invitado.
   * @param targetUserId ID del usuario objetivo.
   * @private
   */
  private async resolveStorageUserId(targetUserId: string): Promise<string> {
    const memberships = await this.inviteRepository.listMembershipsForMember(targetUserId);
    const active = memberships.find((m) => m.active);
    if (active) {
      const scope = await this.resolveScope.execute(targetUserId, active.hostUserId);
      return scope.storageUserId;
    }
    return targetUserId;
  }

  /**
   * Valida si el solicitante tiene permiso para ver los datos estéticos del perfil.
   * @param requesterId ID del usuario autenticado.
   * @param targetId ID del dueño del perfil.
   * @param data Datos normalizados del perfil.
   * @private
   */
  private async checkPrivacyPermissions(requesterId: string, targetId: string, data: any): Promise<boolean> {
    if (requesterId === targetId) {
      return true;
    }

    if (data.shareVisualProfileWithHosts) {
      const m = await this.inviteRepository.getMembership(requesterId, targetId);
      if (m?.active) return true;
    }

    if (data.shareVisualProfileWithMembers) {
      const m = await this.inviteRepository.getMembership(targetId, requesterId);
      if (m?.active) return true;

      const requesterMemberships = await this.inviteRepository.listMembershipsForMember(requesterId);
      const targetMemberships = await this.inviteRepository.listMembershipsForMember(targetId);

      const activeReqHost = requesterMemberships.find((mem) => mem.active)?.hostUserId;
      const activeTarHost = targetMemberships.find((mem) => mem.active)?.hostUserId;

      if (activeReqHost && activeReqHost === activeTarHost) {
        return true;
      }
    }

    return false;
  }
}
