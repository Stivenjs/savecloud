export interface ShareTokenPayload {
  userId: string;
  gameId: string;
  expiresAt: string;
}

export type GetTokenResult =
  | { status: "ok"; payload: ShareTokenPayload }
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "error"; cause: unknown };
