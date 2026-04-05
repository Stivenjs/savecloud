import type { CloudInviteRepository } from "../../domain/ports/CloudInviteRepository";
import type { ConnectionRepository } from "../../domain/ports/ConnectionRepository";
import type { WebSocketNotifier } from "../../domain/ports/WebSocketNotifier";

export interface BroadcastActivityInput {
  broadcasterUserId: string;
  gameId: string;
  gameName?: string;
}

/**
 * @class BroadcastActivityUseCase
 * @description Reparte una notificación efímera a todos los compañeros de la misma nube.
 */
export class BroadcastActivityUseCase {
  constructor(
    private readonly inviteRepository: CloudInviteRepository,
    private readonly connectionRepository: ConnectionRepository,
    private readonly notifier: WebSocketNotifier
  ) {}

  /**
   * Ejecuta la propagación del evento.
   * @param {BroadcastActivityInput} input
   */
  async execute(input: BroadcastActivityInput): Promise<void> {
    const broadcasterId = input.broadcasterUserId;

    let cloudHostId = broadcasterId;

    const membershipsAsMember = await this.inviteRepository.listMembershipsForMember(broadcasterId);
    const activeHost = membershipsAsMember.find((m) => m.active)?.hostUserId;

    if (activeHost) {
      cloudHostId = activeHost;
    }

    const cloudMemberships = await this.inviteRepository.listMembershipsForHost(cloudHostId);

    const activeMemberIds = cloudMemberships.filter((m) => m.active).map((m) => m.memberUserId);

    const allPeersInCloud = [cloudHostId, ...activeMemberIds];

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
        this.notifier.sendToConnection(connectionId, payload).catch((error) => {
          console.error(`Error enviando a ${connectionId}:`, error);
        });
      }
    }
  }
}
