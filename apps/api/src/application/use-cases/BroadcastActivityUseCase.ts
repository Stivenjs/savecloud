import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import type { WebSocketNotifier } from "@domain/ports/WebSocketNotifier";

export interface BroadcastActivityInput {
  broadcasterUserId: string;
  gameId?: string;
  gameName?: string;
  presenceStatus: "playing" | "online";
}

/**
 * @class BroadcastActivityUseCase
 * @description Reparte una notificación efímera a todos los compañeros de la misma nube.
 * Soporta usuarios existentes: detecta automáticamente si son Hosts o Invitados.
 */
export class BroadcastActivityUseCase {
  constructor(
    private readonly inviteRepository: CloudInviteRepository,
    private readonly connectionRepository: ConnectionRepository,
    private readonly notifier: WebSocketNotifier
  ) {}

  async execute(input: BroadcastActivityInput): Promise<void> {
    const broadcasterId = input.broadcasterUserId;
    const normalizedGameId = input.gameId?.trim() || "";
    const resolvedGameName = input.gameName?.trim() || normalizedGameId || null;

    let activeCloudHostId = broadcasterId;

    const membershipsAsMember = await this.inviteRepository.listMembershipsForMember(broadcasterId);
    const activeMembership = membershipsAsMember.find((m) => m.active);

    if (activeMembership) {
      activeCloudHostId = activeMembership.hostUserId;
    }

    const cloudMemberships = await this.inviteRepository.listMembershipsForHost(activeCloudHostId);

    const activeMemberIds = cloudMemberships.filter((m) => m.active).map((m) => m.memberUserId);

    const allPeersInCloud = [activeCloudHostId, ...activeMemberIds];
    const timestamp = Date.now();
    const presencePayload = {
      type: "PRESENCE_UPDATE",
      data: {
        userId: broadcasterId,
        status: input.presenceStatus,
        gameId: normalizedGameId || null,
        gameName: resolvedGameName,
        timestamp,
      },
    };

    const friendPlayingPayload =
      input.presenceStatus === "playing"
        ? {
            type: "FRIEND_PLAYING",
            data: {
              friendUserId: broadcasterId,
              gameId: normalizedGameId,
              gameName: resolvedGameName || normalizedGameId,
              timestamp,
            },
          }
        : null;

    for (const targetUserId of allPeersInCloud) {
      if (targetUserId === broadcasterId) continue;

      const connectionIds = await this.connectionRepository.getConnectionsByUser(targetUserId);

      for (const connectionId of connectionIds) {
        this.notifier.sendToConnection(connectionId, presencePayload).catch((err) => {
          console.warn(`[WS] Fallo al enviar a ${connectionId} (${targetUserId}):`, err.message);
        });

        if (friendPlayingPayload) {
          this.notifier.sendToConnection(connectionId, friendPlayingPayload).catch((err) => {
            console.warn(`[WS] Fallo al enviar FRIEND_PLAYING a ${connectionId} (${targetUserId}):`, err.message);
          });
        }
      }
    }
  }
}
