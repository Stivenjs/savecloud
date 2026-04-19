import { invoke } from "@tauri-apps/api/core";

export type StreamSignalEvent =
  | "STREAM_SYNC_REQUEST"
  | "STREAM_CREATED"
  | "STREAM_ENDED"
  | "STREAM_JOIN"
  | "STREAM_JOIN_REJECTED"
  | "STREAM_LEAVE"
  | "STREAM_VIEWERS"
  | "STREAM_OFFER"
  | "STREAM_ANSWER"
  | "STREAM_ICE";

export interface SendStreamSignalInput {
  event: StreamSignalEvent;
  streamId: string;
  targetUserId?: string;
  payload?: unknown;
}

export async function sendCloudStreamSignal(input: SendStreamSignalInput): Promise<void> {
  await invoke("send_cloud_stream_signal", {
    event: input.event,
    streamId: input.streamId,
    targetUserId: input.targetUserId,
    payload: input.payload ?? null,
  });
}
