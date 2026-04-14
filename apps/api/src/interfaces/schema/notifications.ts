import { Type, type Static } from "@sinclair/typebox";

export const NotificationRecordSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  userId: Type.String({ minLength: 1 }),
  kind: Type.String({ minLength: 1 }),
  severity: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  body: Type.String({ minLength: 1 }),
  gameId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  operationId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  status: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  reasonCode: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  payloadJson: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  dedupKey: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  createdAt: Type.String({ minLength: 1 }),
  updatedAt: Type.String({ minLength: 1 }),
  readAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  dismissedAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sourceDeviceId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  serverUpdatedAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  pendingSync: Type.Optional(Type.Boolean()),
  syncVersion: Type.Integer(),
});

export const NotificationBatchSchema = Type.Object({
  items: Type.Array(NotificationRecordSchema, { minItems: 1, maxItems: 200 }),
});
export type NotificationBatchBody = Static<typeof NotificationBatchSchema>;

export const NotificationListQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  cursor: Type.Optional(Type.String()),
});
export type NotificationListQuery = Static<typeof NotificationListQuerySchema>;

export const NotificationAckSchema = Type.Object({
  ids: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 500 }),
  read: Type.Optional(Type.Boolean()),
  dismiss: Type.Optional(Type.Boolean()),
});
export type NotificationAckBody = Static<typeof NotificationAckSchema>;
