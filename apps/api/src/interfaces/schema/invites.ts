import { Type, type Static } from "@sinclair/typebox";

export const CreateInviteSchema = Type.Object({
  inviteeUserId: Type.Optional(Type.String({ minLength: 1 })),
  withToken: Type.Optional(Type.Boolean()),
  expiresInDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
  wsUrl: Type.Optional(Type.String()),
});
export type CreateInviteBody = Static<typeof CreateInviteSchema>;

export const RespondInviteSchema = Type.Object({
  action: Type.Union([Type.Literal("accept"), Type.Literal("reject")]),
});
export type RespondInviteBody = Static<typeof RespondInviteSchema>;

export const AcceptByTokenSchema = Type.Object({
  token: Type.String({ minLength: 8 }),
});
export type AcceptByTokenBody = Static<typeof AcceptByTokenSchema>;

export const SetGameShareSchema = Type.Object({
  memberUserId: Type.String({ minLength: 1 }),
  gameId: Type.String({ minLength: 1 }),
});
export type SetGameShareBody = Static<typeof SetGameShareSchema>;

export const MembershipActionSchema = Type.Object({
  hostUserId: Type.String({ minLength: 1 }),
  memberUserId: Type.String({ minLength: 1 }),
});
export type MembershipActionBody = Static<typeof MembershipActionSchema>;
