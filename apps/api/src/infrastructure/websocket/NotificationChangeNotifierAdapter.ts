import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import type { NotificationChangeNotifier } from "@domain/ports/NotificationChangeNotifier";
import type { WebSocketNotifier } from "@domain/ports/WebSocketNotifier";

export const NOTIFICATIONS_CHANGED_MESSAGE = "NOTIFICATIONS_CHANGED";

/** Adapta los cambios de persistencia al aviso WebSocket del usuario. */
export class NotificationChangeNotifierAdapter implements NotificationChangeNotifier {
  constructor(
    private readonly connectionRepository?: ConnectionRepository,
    private readonly webSocketNotifier?: WebSocketNotifier
  ) {}

  async notifyChanged(userId: string, cursor: string): Promise<void> {
    const { connectionRepository, webSocketNotifier } = this;
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
