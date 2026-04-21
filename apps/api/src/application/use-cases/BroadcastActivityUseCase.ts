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
 *
 * ## Deduplicación de FRIEND_PLAYING
 *
 * El mensaje FRIEND_PLAYING provoca un overlay en el cliente del amigo.
 * Para evitar que el overlay aparezca en cada heartbeat (cada 45 s), este
 * use-case compara el `gameId` actual con el que el broadcaster tenía
 * registrado en DynamoDB (`activityGameId`) ANTES de actualizar el registro.
 *
 * Regla:
 * - Si `activityGameId` en DynamoDB === `gameId` entrante → heartbeat silencioso:
 *   solo se envía PRESENCE_UPDATE, NO FRIEND_PLAYING.
 * - Si cambiaron (o no había registro) → primera vez o cambio de juego:
 *   se envía PRESENCE_UPDATE + FRIEND_PLAYING.
 * - Si `gameId` está vacío (stop signal) → solo PRESENCE_UPDATE con status "online".
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
    const isStopSignal = normalizedGameId === "";

    // ── Resolver el host de la nube ──────────────────────────────────────────
    let activeCloudHostId = broadcasterId;

    const membershipsAsMember = await this.inviteRepository.listMembershipsForMember(broadcasterId);
    const activeMembership = membershipsAsMember.find((m) => m.active);

    if (activeMembership) {
      activeCloudHostId = activeMembership.hostUserId;
    }

    const cloudMemberships = await this.inviteRepository.listMembershipsForHost(activeCloudHostId);
    const activeMemberIds = cloudMemberships.filter((m) => m.active).map((m) => m.memberUserId);
    const allPeersInCloud = [activeCloudHostId, ...activeMemberIds];

    let isNewGameSession = false;

    if (!isStopSignal) {
      try {
        const broadcasterConnections = await this.connectionRepository.getConnectionPresenceByUser(broadcasterId);

        if (broadcasterConnections.length === 0) {
          isNewGameSession = true;
        } else {
          const prevGameId = broadcasterConnections[0].activityGameId ?? "";
          isNewGameSession = prevGameId !== normalizedGameId;
        }
      } catch {
        // Si falla la consulta, asumimos que es nuevo para no silenciar
        // notificaciones importantes.
        isNewGameSession = true;
      }
    }

    const timestamp = Date.now();

    const presencePayload = {
      type: "PRESENCE_UPDATE",
      data: {
        userId: broadcasterId,
        status: isStopSignal ? "online" : "playing",
        gameId: isStopSignal ? null : normalizedGameId,
        gameName: isStopSignal ? null : resolvedGameName,
        timestamp,
      },
    };

    const friendPlayingPayload =
      !isStopSignal && isNewGameSession
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
        this.notifier.sendToConnection(connectionId, presencePayload).catch((err: Error) => {
          console.warn(`[WS] Fallo al enviar PRESENCE_UPDATE a ${connectionId} (${targetUserId}):`, err.message);
        });

        if (friendPlayingPayload) {
          this.notifier.sendToConnection(connectionId, friendPlayingPayload).catch((err: Error) => {
            console.warn(`[WS] Fallo al enviar FRIEND_PLAYING a ${connectionId} (${targetUserId}):`, err.message);
          });
        }
      }
    }
  }
}
