import type { CloudInvite, CloudMembership } from "@domain/entities/CloudInvite";

export interface CreateInviteInput {
  hostUserId: string;
  inviteeUserId?: string;
  ttlSeconds: number;
  withToken: boolean;
  wsUrl?: string;
}

export interface CloudInviteRepository {
  createInvite(input: CreateInviteInput): Promise<CloudInvite>;
  listPendingInvitesForUser(userId: string): Promise<CloudInvite[]>;
  getInviteById(id: string): Promise<CloudInvite | null>;
  getInviteByToken(token: string): Promise<CloudInvite | null>;
  updateInvite(invite: CloudInvite): Promise<void>;
  upsertMembership(membership: CloudMembership): Promise<void>;
  getMembership(hostUserId: string, memberUserId: string): Promise<CloudMembership | null>;
  listMembershipsForMember(memberUserId: string): Promise<CloudMembership[]>;
  listMembershipsForHost(hostUserId: string): Promise<CloudMembership[]>;
  setGameShared(hostUserId: string, memberUserId: string, gameId: string, shared: boolean): Promise<void>;
  isGameSharedWithMember(hostUserId: string, memberUserId: string, gameId: string): Promise<boolean>;
  listSharedGamesForMember(hostUserId: string, memberUserId: string): Promise<string[]>;
  deactivateMembership(hostUserId: string, memberUserId: string): Promise<void>;

  /**
   * Marca una membresía como pendiente de eliminación y la desactiva de inmediato.
   * La purga real ocurre cuando `scheduledDeletionAt` sea alcanzado por el worker.
   *
   * @param hostUserId - Dueño de la nube.
   * @param memberUserId - Miembro a eliminar.
   * @param scheduledDeletionAt - ISO timestamp en el que se ejecutará la purga.
   * @param deletedBy - userId del host que inició la eliminación.
   */
  scheduleMemberDeletion(
    hostUserId: string,
    memberUserId: string,
    scheduledDeletionAt: string,
    deletedBy: string
  ): Promise<void>;

  /**
   * Cancela una eliminación programada durante el grace period.
   * Restaura `active: true` y limpia los campos de eliminación.
   *
   * @param hostUserId - Dueño de la nube.
   * @param memberUserId - Miembro cuya eliminación se cancela.
   */
  cancelScheduledMemberDeletion(hostUserId: string, memberUserId: string): Promise<void>;

  /**
   * Lista las membresías cuyo `scheduledDeletionAt` ya fue alcanzado.
   * Utilizado por el worker de purga para identificar qué datos limpiar.
   *
   * @param now - ISO timestamp de referencia (normalmente `new Date().toISOString()`).
   * @returns Lista de membresías listas para purga física.
   */
  listMembershipsReadyForPurge(now: string): Promise<CloudMembership[]>;

  /**
   * Elimina físicamente la entrada MEMBERSHIP de DynamoDB tras la purga de datos.
   * Solo llamar después de haber borrado los archivos S3 y ACLs de la membresía.
   *
   * @param hostUserId - Dueño de la nube.
   * @param memberUserId - Miembro cuya entrada se elimina.
   */
  deleteMembershipRecord(hostUserId: string, memberUserId: string): Promise<void>;

  /**
   * Elimina todos los registros GAME_SHARE de un miembro con un host específico.
   * Llamar durante la purga para limpiar los ACLs de juegos compartidos.
   *
   * @param hostUserId - Dueño de la nube.
   * @param memberUserId - Miembro cuyos ACLs se eliminan.
   */
  deleteAllGameSharesForMember(hostUserId: string, memberUserId: string): Promise<void>;
}
