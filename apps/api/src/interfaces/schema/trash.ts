import { Type, type Static } from "@sinclair/typebox";

export const GameIdBodySchema = Type.Object({
  gameId: Type.String({ minLength: 1 }),
});

export type GameIdBody = Static<typeof GameIdBodySchema>;
