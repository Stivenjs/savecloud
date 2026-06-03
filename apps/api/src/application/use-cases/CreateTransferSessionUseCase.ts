import crypto from "crypto";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { GameInventoryRepository } from "@domain/ports/GameInventoryRepository";

export interface CreateTransferSessionInput {
  requesterUserId: string;
  targetUserId: string;
  targetDeviceId: string;
  gameKey: string;
  manifestHash: string;
}

export interface TransferSessionResult {
  sessionId: string;
  token: string;
  expiresAt: string;
  targetUserId: string;
  targetDeviceId: string;
  gameKey: string;
  manifestHash: string;
}

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

export class CreateTransferSessionUseCase {
  constructor(
    private readonly inventoryRepository: GameInventoryRepository,
    private readonly cloudInviteRepository: CloudInviteRepository
  ) {}

  async execute(input: CreateTransferSessionInput): Promise<TransferSessionResult> {
    const requesterId = input.requesterUserId.trim();
    const targetUserId = input.targetUserId.trim();
    const targetDeviceId = input.targetDeviceId.trim();
    const gameKey = input.gameKey.trim();
    const manifestHash = input.manifestHash.trim();

    if (!requesterId || !targetUserId || !targetDeviceId || !gameKey || !manifestHash) {
      throw new Error("Invalid transfer session input");
    }

    await this.assertSameCloud(requesterId, targetUserId);

    const record = await this.inventoryRepository.getDeviceRecord(targetUserId, targetDeviceId);
    if (!record?.sharingEnabled) {
      throw new Error("Target device inventory not found or sharing disabled");
    }

    const game = record.games.find((g) => g.gameKey === gameKey && g.status === "verified");
    if (!game || game.manifestHash !== manifestHash) {
      throw new Error("Game manifest mismatch on target device");
    }

    const sessionId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    await this.inventoryRepository.putTransferSession({
      sessionId,
      token,
      requesterUserId: requesterId,
      targetUserId,
      targetDeviceId,
      gameKey,
      manifestHash,
      expiresAt,
    });

    return {
      sessionId,
      token,
      expiresAt,
      targetUserId,
      targetDeviceId,
      gameKey,
      manifestHash,
    };
  }

  private async assertSameCloud(requesterId: string, targetUserId: string): Promise<void> {
    if (requesterId === targetUserId) {
      throw new Error("Cannot transfer from yourself");
    }

    const requesterHosts = await this.cloudInviteRepository.listMembershipsForMember(requesterId);
    const active = requesterHosts.find((m) => m.active);
    const hostUserId = active?.hostUserId ?? requesterId;

    const members = await this.cloudInviteRepository.listMembershipsForHost(hostUserId);
    const peerIds = new Set([hostUserId, ...members.filter((m) => m.active).map((m) => m.memberUserId)]);

    if (!peerIds.has(targetUserId)) {
      throw new Error("Target user is not in your cloud");
    }
  }
}
