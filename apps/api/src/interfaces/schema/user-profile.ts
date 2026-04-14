import { Type, type Static } from "@sinclair/typebox";

export const GetFriendProfileParamsSchema = Type.Object({
  targetUserId: Type.String({ minLength: 1 }),
});

export type GetFriendProfileParams = Static<typeof GetFriendProfileParamsSchema>;
