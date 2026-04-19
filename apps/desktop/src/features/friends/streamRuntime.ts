interface HostStreamRuntime {
  mediaStream: MediaStream;
  peers: Map<string, RTCPeerConnection>;
  viewers: Set<string>;
  onDispose?: () => void;
}

const hostRuntimeByStreamId = new Map<string, HostStreamRuntime>();

export function registerHostStreamRuntime(streamId: string, mediaStream: MediaStream, onDispose?: () => void): void {
  hostRuntimeByStreamId.set(streamId, {
    mediaStream,
    peers: new Map(),
    viewers: new Set(),
    onDispose,
  });
}

export function getHostStreamRuntime(streamId: string): HostStreamRuntime | null {
  return hostRuntimeByStreamId.get(streamId) ?? null;
}

export function clearHostStreamRuntime(streamId: string, stopTracks = true): void {
  const runtime = hostRuntimeByStreamId.get(streamId);
  if (!runtime) return;

  for (const peer of runtime.peers.values()) {
    peer.close();
  }
  runtime.peers.clear();
  runtime.viewers.clear();

  if (stopTracks) {
    for (const track of runtime.mediaStream.getTracks()) {
      track.stop();
    }
  }

  runtime.onDispose?.();

  hostRuntimeByStreamId.delete(streamId);
}
