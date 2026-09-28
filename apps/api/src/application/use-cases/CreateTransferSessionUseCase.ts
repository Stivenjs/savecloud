import crypto from "crypto";
import type { CloudInviteRepository } from "@domain/ports/CloudInviteRepository";
import type { GameInventoryRepository } from "@domain/ports/GameInventoryRepository";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import type { WebSocketNotifier } from "@domain/ports/WebSocketNotifier";
import { ApplicationError } from "@application/errors/ApplicationError";

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
    private readonly cloudInviteRepository: CloudInviteRepository,
    private readonly connectionRepository?: ConnectionRepository,
    private readonly notifier?: WebSocketNotifier
  ) {}

  async execute(input: CreateTransferSessionInput): Promise<TransferSessionResult> {
    const requesterId = input.requesterUserId.trim();
    const targetUserId = input.targetUserId.trim();
    const targetDeviceId = input.targetDeviceId.trim();
    const gameKey = input.gameKey.trim();
    const manifestHash = input.manifestHash.trim();

    if (!requesterId || !targetUserId || !targetDeviceId || !gameKey || !manifestHash) {
      throw new ApplicationError("INVALID_ARGUMENT", "Faltan datos requeridos para iniciar la transferencia.");
    }

    await this.assertSameCloud(requesterId, targetUserId);

    const record = await this.inventoryRepository.getDeviceRecord(targetUserId, targetDeviceId);
    if (!record?.sharingEnabled) {
      throw new ApplicationError("NOT_FOUND", "El dispositivo no está disponible para compartir juegos.");
    }

    const game = record.games.find((g) => g.gameKey === gameKey && g.status === "verified");
    if (!game || game.manifestHash !== manifestHash) {
      throw new ApplicationError("CONFLICT", "El manifiesto del juego cambió en el dispositivo destino.");
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

    if (this.connectionRepository && this.notifier) {
      try {
        const connectionIds = await this.connectionRepository.getConnectionsByUserAndDevice(
          targetUserId,
          targetDeviceId
        );
        const payload = {
          type: "TRANSFER_SESSION_PENDING",
          data: {
            token,
            gameKey,
            manifestHash,
            expiresAt,
          },
        };
        for (const connId of connectionIds) {
          this.notifier.sendToConnection(connId, payload).catch((err: any) => {
            console.warn(`[WS] Failed to send TRANSFER_SESSION_PENDING to ${connId}:`, err.message);
          });
        }
      } catch (err) {
        console.error("[WS] Error notifying pending transfer session via WebSocket:", err);
      }
    }

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
      throw new ApplicationError("INVALID_ARGUMENT", "No puedes transferir un juego a tu propio usuario.");
    }

    const requesterHosts = await this.cloudInviteRepository.listMembershipsForMember(requesterId);
    const active = requesterHosts.find((m) => m.active);
    const hostUserId = active?.hostUserId ?? requesterId;

    const members = await this.cloudInviteRepository.listMembershipsForHost(hostUserId);
    const peerIds = new Set([hostUserId, ...members.filter((m) => m.active).map((m) => m.memberUserId)]);

    if (!peerIds.has(targetUserId)) {
      throw new ApplicationError("FORBIDDEN", "El usuario destino no pertenece a tu nube.");
    }
  }
}
