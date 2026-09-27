import type { FastifyInstance, FastifyReply } from "fastify";
import { getErrorMessage, getUserId } from "@shared/utils";
import { AcknowledgeNotificationsUseCase } from "@application/use-cases/AcknowledgeNotificationsUseCase";
import { ListNotificationsUseCase } from "@application/use-cases/ListNotificationsUseCase";
import { SyncNotificationBatchUseCase } from "@application/use-cases/SyncNotificationBatchUseCase";
import {
  NotificationAckSchema,
  type NotificationAckBody,
  NotificationBatchSchema,
  type NotificationBatchBody,
  NotificationListQuerySchema,
  type NotificationListQuery,
} from "@interfaces/schema/notifications";

export interface NotificationRouteDependencies {
  listNotificationsUseCase: ListNotificationsUseCase;
  syncNotificationBatchUseCase: SyncNotificationBatchUseCase;
  acknowledgeNotificationsUseCase: AcknowledgeNotificationsUseCase;
}

export async function registerNotificationRoutes(
  app: FastifyInstance,
  deps: NotificationRouteDependencies
): Promise<void> {
  app.get<{ Querystring: NotificationListQuery }>(
    "/notifications",
    { schema: { querystring: NotificationListQuerySchema } },
    async (request, reply: FastifyReply) => {
      try {
        const result = await deps.listNotificationsUseCase.execute(
          getUserId(request),
          request.query.cursor?.trim() ?? "",
          request.query.limit ?? 50
        );
        return reply.send(result);
      } catch (err) {
        const message = getErrorMessage(err);
        request.log.error({ err, message }, "Falló la consulta de notificaciones");
        return reply.status(500).send({ error: "Internal Server Error", message });
      }
    }
  );

  app.post<{ Body: NotificationBatchBody }>(
    "/notifications/batch",
    { schema: { body: NotificationBatchSchema } },
    async (request, reply: FastifyReply) => {
      try {
        await deps.syncNotificationBatchUseCase.execute(getUserId(request), request.body.items);
        return reply.status(204).send();
      } catch (err) {
        const message = getErrorMessage(err);
        request.log.error({ err, message }, "Falló la sincronización de notificaciones");
        return reply.status(500).send({ error: "Internal Server Error", message });
      }
    }
  );

  app.post<{ Body: NotificationAckBody }>(
    "/notifications/ack",
    { schema: { body: NotificationAckSchema } },
    async (request, reply: FastifyReply) => {
      try {
        const { ids, read = false, dismiss = false } = request.body;
        await deps.acknowledgeNotificationsUseCase.execute(getUserId(request), ids, read, dismiss);
        return reply.status(204).send();
      } catch (err) {
        const message = getErrorMessage(err);
        request.log.error({ err, message }, "Falló la actualización de notificaciones");
        return reply.status(500).send({ error: "Internal Server Error", message });
      }
    }
  );
}
