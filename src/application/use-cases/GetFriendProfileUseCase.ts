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
    const storageUserId = await this.resolveStorageUserId(targetUserId);

    const saves = await this.saveRepository.listByUserAndGame(storageUserId, "__config__");
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

    const allowVisual = await this.checkPrivacyPermissions(requesterUserId, targetUserId, data);

    const totalPlaytime = data.games.reduce(
      (sum: number, g: { playtimeSeconds?: number }) => sum + (g.playtimeSeconds ?? 0),
      0
    );

    return {
      userId: targetUserId,
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
    if (data.shareVisualProfileWithHosts) {
      const m = await this.inviteRepository.getMembership(requesterId, targetId);
      if (m?.active) return true;
    }
    if (data.shareVisualProfileWithMembers) {
      const m = await this.inviteRepository.getMembership(targetId, requesterId);
      if (m?.active) return true;
    }
    return false;
  }
}
