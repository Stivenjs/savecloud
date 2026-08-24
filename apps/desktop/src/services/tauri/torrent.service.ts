import { invoke } from "@tauri-apps/api/core";

/** Información de un archivo .torrent en la nube */
export interface CloudTorrentInfo {
  gameId: string;
  key: string;
  filename: string;
  lastModified: string;
  size?: number;
}

/** Inicia la descarga de un torrent */
export async function startTorrentDownload(magnet: string, savePath: string): Promise<string> {
  return invoke<string>("start_torrent_download", { magnet, savePath });
}

/** Inicia la descarga de un torrent a partir de un archivo .torrent */
export async function startTorrentFileDownload(filePath: string, savePath: string): Promise<string> {
  return invoke<string>("start_torrent_file_download", { filePath, savePath });
}

/** Cancela la descarga de un torrent */
export async function cancelTorrent(infoHash: string): Promise<void> {
  await invoke("cancel_torrent", { infoHash });
}

/** Pausa la descarga de un torrent */
export async function pauseTorrent(infoHash: string): Promise<void> {
  await invoke("pause_torrent", { infoHash });
}

/** Reanuda la descarga de un torrent pausado */
export async function resumeTorrent(infoHash: string): Promise<void> {
  await invoke("resume_torrent", { infoHash });
}

/** Lista infoHash de torrents activos para rehidratación. */
export async function getActiveTorrentDownloads(): Promise<string[]> {
  return invoke<string[]>("get_active_torrent_downloads");
}

/** Sube un archivo .torrent a la nube asociado a un juego */
export async function uploadTorrentToCloud(gameId: string, torrentPath: string): Promise<void> {
  await invoke("upload_torrent_to_cloud", { gameId, torrentPath });
}

/** Lista los archivos .torrent almacenados en la nube para un juego */
export async function listCloudTorrents(gameId: string): Promise<CloudTorrentInfo[]> {
  return invoke<CloudTorrentInfo[]>("list_cloud_torrents", { gameId });
}

/** Descarga un .torrent desde la nube e inicia la descarga P2P del contenido */
export async function downloadTorrentFromCloud(gameId: string, torrentKey: string, savePath: string): Promise<string> {
  return invoke<string>("download_torrent_from_cloud", { gameId, torrentKey, savePath });
}

/** Elimina un .torrent almacenado en la nube */
export async function deleteCloudTorrent(gameId: string, torrentKey: string): Promise<void> {
  await invoke("delete_cloud_torrent", { gameId, torrentKey });
}
