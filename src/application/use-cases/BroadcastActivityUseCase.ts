import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import type { WebSocketNotifier } from "@domain/ports/WebSocketNotifier";

export interface BroadcastActivityInput {
  broadcasterUserId: string;
  gameId: string;
  gameName?: string;
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

    let activeCloudHostId = broadcasterId;

    const membershipsAsMember = await this.inviteRepository.listMembershipsForMember(broadcasterId);
    const activeMembership = membershipsAsMember.find((m) => m.active);

    if (activeMembership) {
      activeCloudHostId = activeMembership.hostUserId;
    }

    const cloudMemberships = await this.inviteRepository.listMembershipsForHost(activeCloudHostId);

    const activeMemberIds = cloudMemberships.filter((m) => m.active).map((m) => m.memberUserId);

    const allPeersInCloud = [activeCloudHostId, ...activeMemberIds];

    const payload = {
      type: "FRIEND_PLAYING",
      data: {
        friendUserId: broadcasterId,
        gameId: input.gameId,
        gameName: input.gameName || input.gameId,
        timestamp: Date.now(),
      },
    };

    for (const targetUserId of allPeersInCloud) {
      if (targetUserId === broadcasterId) continue;

      const connectionIds = await this.connectionRepository.getConnectionsByUser(targetUserId);

      for (const connectionId of connectionIds) {
        this.notifier.sendToConnection(connectionId, payload).catch((err) => {
          console.warn(`[WS] Fallo al enviar a ${connectionId} (${targetUserId}):`, err.message);
        });
      }
    }
  }
}
