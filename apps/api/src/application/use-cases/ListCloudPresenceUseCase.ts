import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";

export type CloudPresenceStatus = "offline" | "online" | "playing";

export interface CloudPresenceItem {
  userId: string;
  status: CloudPresenceStatus;
  gameId: string | null;
  gameName: string | null;
  connectionCount: number;
  lastSeenAt: number | null;
}

export interface ListCloudPresenceOutput {
  items: CloudPresenceItem[];
}

const PLAYING_FRESHNESS_MS = 90_000;

/**
 * Devuelve presencia para los usuarios de la misma nube compartida del solicitante.
 */
export class ListCloudPresenceUseCase {
  constructor(
    private readonly inviteRepository: CloudInviteRepository,
    private readonly connectionRepository: ConnectionRepository
  ) {}

  async execute(requesterUserId: string): Promise<ListCloudPresenceOutput> {
    let activeCloudHostId = requesterUserId;

    const membershipsAsMember = await this.inviteRepository.listMembershipsForMember(requesterUserId);
    const activeMembership = membershipsAsMember.find((m) => m.active);

    if (activeMembership) {
      activeCloudHostId = activeMembership.hostUserId;
    }

    const cloudMemberships = await this.inviteRepository.listMembershipsForHost(activeCloudHostId);
    const activeMemberIds = cloudMemberships.filter((m) => m.active).map((m) => m.memberUserId);

    const peers = [activeCloudHostId, ...activeMemberIds];
    const uniquePeers = [...new Set(peers)];

    const now = Date.now();

    const items = await Promise.all(
      uniquePeers.map(async (userId): Promise<CloudPresenceItem> => {
        const records = await this.connectionRepository.getConnectionPresenceByUser(userId);
        const connectionCount = records.length;

        if (connectionCount === 0) {
          return {
            userId,
            status: "offline",
            gameId: null,
            gameName: null,
            connectionCount,
            lastSeenAt: null,
          };
        }

        const lastSeenAt = records.reduce<number | null>((acc, cur) => {
          const value = typeof cur.lastActivityAt === "number" ? cur.lastActivityAt : null;
          if (value == null) return acc;
          if (acc == null) return value;
          return value > acc ? value : acc;
        }, null);

        const playingRecord = records
          .filter(
            (r) =>
              typeof r.lastActivityAt === "number" &&
              r.activityGameName &&
              now - r.lastActivityAt <= PLAYING_FRESHNESS_MS
          )
          .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))[0];

        if (playingRecord) {
          return {
            userId,
            status: "playing",
            gameId: playingRecord.activityGameId,
            gameName: playingRecord.activityGameName,
            connectionCount,
            lastSeenAt,
          };
        }

        return {
          userId,
          status: "online",
          gameId: null,
          gameName: null,
          connectionCount,
          lastSeenAt,
        };
      })
    );

    const rank: Record<CloudPresenceStatus, number> = {
      playing: 0,
      online: 1,
      offline: 2,
    };

    items.sort((a, b) => rank[a.status] - rank[b.status] || a.userId.localeCompare(b.userId));

    return { items };
  }
}
