import { useMutation, useQuery } from "@tanstack/react-query";
import {
  startTorrentDownload,
  startTorrentFileDownload,
  cancelTorrent,
  pauseTorrent,
  resumeTorrent,
  uploadTorrentToCloud,
  listCloudTorrents,
  downloadTorrentFromCloud,
  deleteCloudTorrent,
} from "@services/tauri";
import { useTorrentStore } from "@store/TorrentStore";

export function useTorrent(gameId?: string) {
  const progress = useTorrentStore((s) => s.progress);

  const startMagnetMutation = useMutation({
    mutationFn: ({ magnet, savePath }: { magnet: string; savePath: string }) => startTorrentDownload(magnet, savePath),
  });

  const startFileMutation = useMutation({
    mutationFn: ({ filePath, savePath }: { filePath: string; savePath: string }) =>
      startTorrentFileDownload(filePath, savePath),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ infoHash }: { infoHash: string }) => cancelTorrent(infoHash),
  });

  const pauseMutation = useMutation({
    mutationFn: ({ infoHash }: { infoHash: string }) => pauseTorrent(infoHash),
  });

  const resumeMutation = useMutation({
    mutationFn: ({ infoHash }: { infoHash: string }) => resumeTorrent(infoHash),
  });

  const uploadToCloudMutation = useMutation({
    mutationFn: ({ gameId, torrentPath }: { gameId: string; torrentPath: string }) =>
      uploadTorrentToCloud(gameId, torrentPath),
  });

  const deleteFromCloudMutation = useMutation({
    mutationFn: ({ gameId, torrentKey }: { gameId: string; torrentKey: string }) =>
      deleteCloudTorrent(gameId, torrentKey),
  });

  const cloudTorrentsQuery = useQuery({
    queryKey: ["cloud-torrents", gameId],
    queryFn: () => listCloudTorrents(gameId!),
    enabled: !!gameId,
  });

  const downloadFromCloudMutation = useMutation({
    mutationFn: ({ gameId, torrentKey, savePath }: { gameId: string; torrentKey: string; savePath: string }) =>
      downloadTorrentFromCloud(gameId, torrentKey, savePath),
  });

  return {
    progress,
    startMagnetMutation,
    startFileMutation,
    cancelMutation,
    pauseMutation,
    resumeMutation,
    uploadToCloudMutation,
    deleteFromCloudMutation,
    cloudTorrentsQuery,
    downloadFromCloudMutation,
  };
}
