export interface ClipMetadata {
  clipId: string;
  userId: string;
  gameId: string;
  filename: string;
  videoKey: string;
  contentType: string;
  createdAt: string;
  posterUrl?: string;
  steamAppId?: string;
  gameTitle?: string;
}

export interface ClipDto extends ClipMetadata {
  cdnUrl: string;
  watchUrl: string;
}

export type GetClipResult =
  | { status: "ok"; clip: ClipMetadata; cdnUrl: string }
  | { status: "not_found" }
  | { status: "error"; cause?: unknown };
