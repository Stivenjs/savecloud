import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { getUnknownErrorMessage } from "@utils/errorMessage";

interface ErrorMetadata {
  code?: string;
  status?: number;
  statusCode?: number;
  requestId?: string;
  retryable?: boolean;
}

function readErrorMetadata(error: unknown): ErrorMetadata {
  let value: unknown = error;
  if (typeof error === "string") value = parseErrorPayload(error);
  else if (error instanceof Error) value = parseErrorPayload(error.message) ?? error;

  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.code === "string" ? { code: record.code } : {}),
    ...(typeof record.status === "number" ? { status: record.status } : {}),
    ...(typeof record.statusCode === "number" ? { statusCode: record.statusCode } : {}),
    ...(typeof record.requestId === "string" ? { requestId: record.requestId } : {}),
    ...(typeof record.retryable === "boolean" ? { retryable: record.retryable } : {}),
  };
}

function parseErrorPayload(message: string): unknown {
  const start = message.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(message.slice(start)) as unknown;
  } catch {
    return null;
  }
}

/**
 * Shared Tauri IPC boundary. Normalize rejected command errors once so UI code
 * can display useful messages without parsing transport-specific payloads.
 */
export async function invoke<T>(
  command: string,
  args?: Record<string, unknown> | number[] | ArrayBuffer | Uint8Array
): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    const normalized = new Error(getUnknownErrorMessage(error));
    Object.assign(normalized, readErrorMetadata(error));
    throw normalized;
  }
}
