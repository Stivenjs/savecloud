import { Type } from "@sinclair/typebox";

export const RefreshBody = Type.Object({
  refreshToken: Type.String({ minLength: 1, maxLength: 256 }),
});
