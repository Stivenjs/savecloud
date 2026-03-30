import { useMemo, useState } from "react";
import { Button, Progress } from "@heroui/react";
import { ChevronDown, ChevronUp, Download } from "lucide-react";
import { useSyncStore } from "@store/SyncStore";
import { useTorrentStore } from "@store/TorrentStore";
import { formatGameDisplayName } from "@utils/gameImage";

type DownloadRow = {
  id: string;
  label: string;
  subtitle: string;
  value: number;
};

export function DownloadsPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const syncTasks = useSyncStore((s) => s.activeTasksById);
  const aggregate = useSyncStore((s) => s.aggregateProgress);
  const torrentTasks = useTorrentStore((s) => s.activeByHash);

  const rows = useMemo<DownloadRow[]>(() => {
    const syncRows = Object.entries(syncTasks).map(([id, task]) => {
      const value = task.total > 0 ? Math.min(100, Math.round((task.loaded / task.total) * 100)) : 0;
      const gameName = task.gameId ? formatGameDisplayName(task.gameId) : "Descarga";
      return {
        id,
        label: gameName,
        subtitle: task.filename,
        value,
      };
    });

    const torrentRows = Object.values(torrentTasks).map((task) => ({
      id: `torrent-${task.infoHash}`,
      label: task.name || "Torrent",
      subtitle: task.state,
      value: Math.max(0, Math.min(100, Math.round(task.progressPercent))),
    }));

    return [...syncRows, ...torrentRows];
  }, [syncTasks, torrentTasks]);

  const totalActive = rows.length;
  if (totalActive === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 w-[360px] max-w-[90vw]">
      <div className="pointer-events-auto rounded-xl border border-default-200 bg-content1/95 p-3 shadow-lg backdrop-blur-sm">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download size={16} className="text-primary" />
            <p className="text-sm font-semibold">Descargas activas ({totalActive})</p>
          </div>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            aria-label={collapsed ? "Expandir descargas" : "Colapsar descargas"}
            onPress={() => setCollapsed((v) => !v)}>
            {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </Button>
        </div>

        <Progress
          size="sm"
          value={aggregate.percent}
          aria-label="Progreso agregado de descargas"
          className="mb-2"
          showValueLabel
        />

        {!collapsed && (
          <div className="max-h-52 space-y-2 overflow-y-auto">
            {rows.map((row) => (
              <div key={row.id} className="rounded-lg border border-default-100 bg-default-50/50 px-2 py-2">
                <p className="truncate text-xs font-medium">{row.label}</p>
                <p className="truncate text-[11px] text-default-500">{row.subtitle}</p>
                <Progress size="sm" value={row.value} className="mt-1" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
