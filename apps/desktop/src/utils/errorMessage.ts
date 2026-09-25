export function getUnknownErrorMessage(err: unknown, fallback = "Error inesperado"): string {
  if (err instanceof Error && err.message?.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  if (err != null && typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}
