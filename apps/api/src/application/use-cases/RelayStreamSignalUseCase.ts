import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import type { WebSocketNotifier } from "@domain/ports/WebSocketNotifier";

export interface RelayStreamSignalInput {
  senderUserId: string;
  event: string;
  streamId: string;
  targetUserId?: string;
  payload?: unknown;
}

/**
 * Reenvia eventos de signaling WebRTC entre miembros activos del mismo cloud.
 */
export class RelayStreamSignalUseCase {
  constructor(
    private readonly inviteRepository: CloudInviteRepository,
    private readonly connectionRepository: ConnectionRepository,
    private readonly notifier: WebSocketNotifier
  ) {}

  async execute(input: RelayStreamSignalInput): Promise<void> {
    const senderId = input.senderUserId.trim();
    const event = input.event.trim();
    const streamId = input.streamId.trim();
    const targetId = input.targetUserId?.trim();

    if (!senderId || !event || !streamId) {
      throw new Error("Invalid input: senderUserId, event and streamId are required");
    }

    let activeCloudHostId = senderId;

    const membershipsAsMember = await this.inviteRepository.listMembershipsForMember(senderId);
    const activeMembership = membershipsAsMember.find((m) => m.active);

    if (activeMembership) {
      activeCloudHostId = activeMembership.hostUserId;
    }

    const cloudMemberships = await this.inviteRepository.listMembershipsForHost(activeCloudHostId);
    const activeMemberIds = cloudMemberships.filter((m) => m.active).map((m) => m.memberUserId);
    const peers = [...new Set([activeCloudHostId, ...activeMemberIds])];

    if (!peers.includes(senderId)) {
      throw new Error("Sender does not belong to the active cloud");
    }

    const recipients = targetId
      ? peers.filter((peerUserId) => peerUserId === targetId && peerUserId !== senderId)
      : peers.filter((peerUserId) => peerUserId !== senderId);

    if (targetId && recipients.length === 0) {
      throw new Error("Target is invalid for this cloud");
    }

    const message = {
      type: "STREAM_SIGNAL",
      data: {
        fromUserId: senderId,
        targetUserId: targetId ?? null,
        event,
        streamId,
        payload: input.payload ?? null,
        timestamp: Date.now(),
      },
    };

    for (const recipientUserId of recipients) {
      const connectionIds = await this.connectionRepository.getConnectionsByUser(recipientUserId);

      for (const connectionId of connectionIds) {
        this.notifier.sendToConnection(connectionId, message).catch((err) => {
          console.warn(`[WS] Fallo al enviar STREAM_SIGNAL a ${connectionId} (${recipientUserId}):`, err.message);
        });
      }
    }
  }
}
