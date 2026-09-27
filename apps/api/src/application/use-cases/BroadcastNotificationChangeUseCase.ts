import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import type { WebSocketNotifier } from "@domain/ports/WebSocketNotifier";

export const NOTIFICATIONS_CHANGED_MESSAGE = "NOTIFICATIONS_CHANGED";

/** Avisa que el inbox cambió; los registros se recuperan mediante la API HTTP. */
export class BroadcastNotificationChangeUseCase {
  constructor(
    private readonly connectionRepository?: ConnectionRepository,
    private readonly webSocketNotifier?: WebSocketNotifier
  ) {}

  async execute(userId: string, cursor: string): Promise<void> {
    const connectionRepository = this.connectionRepository;
    const webSocketNotifier = this.webSocketNotifier;
    if (!connectionRepository || !webSocketNotifier) return;

    try {
      const connectionIds = await connectionRepository.getConnectionsByUser(userId);
      const payload = { type: NOTIFICATIONS_CHANGED_MESSAGE, data: { cursor } };
      await Promise.allSettled(connectionIds.map((id) => webSocketNotifier.sendToConnection(id, payload)));
    } catch (error) {
      // El cambio persistido sigue siendo válido aunque falle la entrega en tiempo real.
      console.warn("[notifications] No se pudo avisar el cambio del inbox", { userId, error });
    }
  }
}
