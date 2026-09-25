import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomBytes } from "node:crypto";

const PREFIX = "share-tokens/";
const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const TOKEN_BYTES = 24;

export interface ShareTokenPayload {
  userId: string;
  gameId: string;
  expiresAt: string; // ISO 8601
}

/**
 * Resultado de `getToken`, discriminado para que el caller pueda reaccionar
 * de forma distinta ante "no existe / expirado" vs "fallo de infraestructura".
 */
export type GetTokenResult =
  | { status: "ok"; payload: ShareTokenPayload }
  | { status: "not_found" }
  | { status: "expired" }
  | { status: "error"; cause: unknown };

/** Verifica que el payload de S3 tenga la forma esperada antes de usarlo. */
function isValidPayload(value: unknown): value is ShareTokenPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === "string" &&
    v.userId.trim() !== "" &&
    typeof v.gameId === "string" &&
    v.gameId.trim() !== "" &&
    typeof v.expiresAt === "string" &&
    !isNaN(Date.parse(v.expiresAt))
  );
}

export class ShareTokenS3 {
  constructor(
    private readonly s3: S3Client,
    private readonly bucketName: string
  ) {}

  /**
   * Crea un share token aleatorio y lo persiste en S3.
   *
   * - Valida que `userId` y `gameId` no estén vacíos.
   * - Usa `hex` encoding (URL-safe, sin caracteres especiales en S3 keys).
   * - Añade el header `Expires` para que lifecycle policies de S3 puedan
   *   limpiar objetos expirados automáticamente sin depender del código.
   */
  async createToken(
    userId: string,
    gameId: string,
    ttlSeconds: number = DEFAULT_TTL_SECONDS
  ): Promise<{ token: string; expiresAt: string }> {
    if (!userId?.trim()) throw new Error("userId must not be empty");
    if (!gameId?.trim()) throw new Error("gameId must not be empty");
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1) {
      throw new Error(`ttlSeconds must be a positive finite number, got: ${ttlSeconds}`);
    }

    const token = randomBytes(TOKEN_BYTES).toString("hex");
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const key = `${PREFIX}${token}`;

    const payload: ShareTokenPayload = {
      userId: userId.trim(),
      gameId: gameId.trim(),
      expiresAt,
    };

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(payload),
        ContentType: "application/json",
        Expires: new Date(Date.now() + ttlSeconds * 1000),
      })
    );

    return { token, expiresAt };
  }

  /**
   * Obtiene y valida un token.
   *
   * Devuelve un resultado discriminado en lugar de `null` para que el caller
   * pueda distinguir entre token inexistente, expirado, o error de S3/red.
   *
   * Si el token existe pero ya expiró, se elimina en background (fire-and-forget
   * con log) para no bloquear la respuesta al cliente.
   */
  async getToken(token: string): Promise<GetTokenResult> {
    if (!token?.trim()) return { status: "not_found" };

    const key = `${PREFIX}${token.trim()}`;

    let body: string;
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucketName, Key: key }));
      body = (await res.Body?.transformToString()) ?? "";
      if (!body) return { status: "not_found" };
    } catch (err) {
      if (err instanceof NoSuchKey) return { status: "not_found" };
      console.error("[ShareTokenS3] S3 GetObject failed", { key, err });
      return { status: "error", cause: err };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      console.error("[ShareTokenS3] Corrupt token payload in S3", { key });
      return { status: "not_found" };
    }

    if (!isValidPayload(parsed)) {
      console.error("[ShareTokenS3] Invalid payload shape", { key, parsed });
      return { status: "not_found" };
    }

    if (new Date(parsed.expiresAt) <= new Date()) {
      this.deleteKey(key, "expired").catch(() => {});
      return { status: "expired" };
    }

    return { status: "ok", payload: parsed };
  }

  /**
   * Revoca explícitamente un token antes de que expire.
   * Devuelve `true` si se eliminó, `false` si no existía, lanza en error real.
   */
  async deleteToken(token: string): Promise<boolean> {
    if (!token?.trim()) return false;
    const key = `${PREFIX}${token.trim()}`;
    return this.deleteKey(key, "revoked");
  }

  private async deleteKey(key: string, reason: "expired" | "revoked"): Promise<boolean> {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: key }));
      console.info("[ShareTokenS3] Token deleted", { key, reason });
      return true;
    } catch (err) {
      console.error("[ShareTokenS3] Failed to delete token", { key, reason, err });
      return false;
    }
  }
}
