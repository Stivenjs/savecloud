import type { FastifyInstance, FastifyReply } from "fastify";
import { getUserId, getErrorMessage } from "@shared/utils";
import type { NotificationRecord } from "@domain/entities/NotificationRecord";
import { S3NotificationStore } from "@infrastructure/persistence/S3NotificationStore";
import {
  NotificationAckSchema,
  type NotificationAckBody,
  NotificationBatchSchema,
  type NotificationBatchBody,
  NotificationListQuerySchema,
  type NotificationListQuery,
} from "@interfaces/schema/notifications";

export async function registerNotificationRoutes(app: FastifyInstance, store: S3NotificationStore): Promise<void> {
  app.get<{ Querystring: NotificationListQuery }>(
    "/notifications",
    { schema: { querystring: NotificationListQuerySchema } },
    async (request, reply: FastifyReply) => {
      try {
        const userId = getUserId(request);
        const limit = request.query.limit ?? 50;
        const cursor = request.query.cursor?.trim() ?? "";

        const file = await store.load(userId);
        let items = file.items.filter((n) => !n.dismissedAt);

        if (cursor) {
          items = items.filter((n) => n.updatedAt > cursor);
        }

        items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
        const page = items.slice(0, Math.min(limit, 500));

        const now = new Date().toISOString();
        const stamped: NotificationRecord[] = page.map((n) => ({
          ...n,
          serverUpdatedAt: n.serverUpdatedAt ?? now,
        }));

        return reply.send({ items: stamped });
      } catch (err) {
        const message = getErrorMessage(err);
        request.log.error({ err, message }, "notifications list failed");
        return reply.status(500).send({ error: "Internal Server Error", message });
      }
    }
  );

  app.post<{ Body: NotificationBatchBody }>(
    "/notifications/batch",
    { schema: { body: NotificationBatchSchema } },
    async (request, reply: FastifyReply) => {
      try {
        const userId = getUserId(request);
        const incoming = request.body.items.filter((i) => i.userId === userId);
        if (incoming.length === 0) {
          return reply.status(204).send();
        }

        const file = await store.load(userId);
        const now = new Date().toISOString();
        const withServer: NotificationRecord[] = incoming.map((n) => ({
          ...n,
          serverUpdatedAt: now,
          pendingSync: false,
        }));

        const merged = S3NotificationStore.mergeAll(file.items, withServer);
        await store.save(userId, { version: 1, items: merged });
        return reply.status(204).send();
      } catch (err) {
        const message = getErrorMessage(err);
        request.log.error({ err, message }, "notifications batch failed");
        return reply.status(500).send({ error: "Internal Server Error", message });
      }
    }
  );

  app.post<{ Body: NotificationAckBody }>(
    "/notifications/ack",
    { schema: { body: NotificationAckSchema } },
    async (request, reply: FastifyReply) => {
      try {
        const userId = getUserId(request);
        const { ids, read, dismiss } = request.body;
        const now = new Date().toISOString();

        const file = await store.load(userId);
        const idSet = new Set(ids);
        const next: NotificationRecord[] = file.items.map((n) => {
          if (!idSet.has(n.id)) return n;
          let readAt = n.readAt ?? null;
          let dismissedAt = n.dismissedAt ?? null;
          if (read) readAt = readAt ?? now;
          if (dismiss) dismissedAt = now;
          return {
            ...n,
            readAt,
            dismissedAt,
            updatedAt: now,
            syncVersion: n.syncVersion + 1,
            serverUpdatedAt: now,
            pendingSync: false,
          };
        });

        await store.save(userId, { version: 1, items: next });
        return reply.status(204).send();
      } catch (err) {
        const message = getErrorMessage(err);
        request.log.error({ err, message }, "notifications ack failed");
        return reply.status(500).send({ error: "Internal Server Error", message });
      }
    }
  );
}
