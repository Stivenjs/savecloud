export type DownloadSourceKind = "sync" | "torrent" | "sources";

export interface TorrentExtraStats {
  uploadSpeedBytes: number;
  peersConnected: number;
  state: string;
}

export interface DownloadRow {
  id: string;
  label: string;
  subtitle: string;
  value: number;
  source: DownloadSourceKind;
  jobId?: string;
  infoHash?: string;
  isPaused?: boolean;
  canPause?: boolean;
  canResume?: boolean;
  canCancel?: boolean;
  loaded?: number;
  total?: number;
  speedBps?: number | null;
  etaSeconds?: number | null;
  status?: string;
  statusDetail?: string | null;
  torrentExtra?: TorrentExtraStats;
}

export interface DownloadsAggregateData {
  loaded: number;
  total: number;
  percent: number;
}
