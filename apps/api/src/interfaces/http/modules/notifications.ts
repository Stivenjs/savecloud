import type { FastifyInstance } from "fastify";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";
import type { NotificationRepository } from "@domain/ports/NotificationRepository";
import type { WebSocketNotifier } from "@domain/ports/WebSocketNotifier";
import { AcknowledgeNotificationsUseCase } from "@application/use-cases/AcknowledgeNotificationsUseCase";
import { ListNotificationsUseCase } from "@application/use-cases/ListNotificationsUseCase";
import { SyncNotificationBatchUseCase } from "@application/use-cases/SyncNotificationBatchUseCase";
import { NotificationChangeNotifierAdapter } from "@infrastructure/websocket/NotificationChangeNotifierAdapter";
import { registerNotificationRoutes } from "@interfaces/http/routes/notifications.routes";

export async function registerNotificationsModule(
  app: FastifyInstance,
  deps: {
    notificationRepository?: NotificationRepository;
    connectionRepository?: ConnectionRepository;
    webSocketNotifier?: WebSocketNotifier;
  }
): Promise<void> {
  if (!deps.notificationRepository) return;

  const notificationChangeNotifier = new NotificationChangeNotifierAdapter(
    deps.connectionRepository,
    deps.webSocketNotifier
  );
  await registerNotificationRoutes(app, {
    listNotificationsUseCase: new ListNotificationsUseCase(deps.notificationRepository),
    syncNotificationBatchUseCase: new SyncNotificationBatchUseCase(
      deps.notificationRepository,
      notificationChangeNotifier
    ),
    acknowledgeNotificationsUseCase: new AcknowledgeNotificationsUseCase(
      deps.notificationRepository,
      notificationChangeNotifier
    ),
  });
}
