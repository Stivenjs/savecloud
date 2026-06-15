import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StreamingState } from "@components/streaming/StreamingPanel";
import { Chip } from "@heroui/react";

export const StreamingOverlay = () => {
  const queryClient = useQueryClient();
  const { data: state } = useQuery<StreamingState>({
    queryKey: ["streaming_get_state"],
    queryFn: () => invoke("streaming_get_state"),
  });

  useEffect(() => {
    import("@tauri-apps/api/event").then(({ listen }) => {
      const unlisten = listen("streaming-state-changed", () => {
        queryClient.invalidateQueries({ queryKey: ["streaming_get_state"] });
      });
      return () => {
        unlisten.then((fn) => fn());
      };
    });
  }, [queryClient]);

  const isPlaying = typeof state === "object" && state !== null && "Playing" in state;

  if (!isPlaying) return null;

  return (
    <div className="fixed top-6 left-6 z-9999 pointer-events-none">
      <Chip
        color="success"
        variant="shadow"
        classNames={{
          base: "bg-black/50 backdrop-blur-md border border-white/10 p-2",
          content: "flex items-center gap-2",
        }}>
        <div className="w-2 h-2 rounded-full bg-success-500 animate-pulse" />
        <span className="text-white text-xs font-semibold tracking-wider">STREAMING</span>
        <span className="text-default-400 text-xs font-mono ml-1">{(state as any).Playing.host_ip}</span>
      </Chip>
    </div>
  );
};
