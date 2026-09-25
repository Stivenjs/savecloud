import { Type, type Static } from "@sinclair/typebox";

export const CompleteMultipartBodySchema = Type.Object({
  key: Type.String({ minLength: 1 }),
  uploadId: Type.String({ minLength: 1 }),
  parts: Type.Array(
    Type.Object({
      partNumber: Type.Integer({ minimum: 1 }),
      etag: Type.String({ minLength: 1 }),
    }),
    { minItems: 1 }
  ),
});

export type CompleteMultipartBody = Static<typeof CompleteMultipartBodySchema>;
