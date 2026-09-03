import { invoke } from "@tauri-apps/api/core";

export type DownloadProtocol = "http" | "torrentMagnet" | "torrentFile" | "peerLan" | "unknown";
export type SourceJobStatus = "queued" | "running" | "extracting" | "paused" | "cancelled" | "completed" | "failed";
export type ImportMode = "merge" | "replace" | "updateorcreate";

export interface SourceUri {
  uri: string;
  protocol: DownloadProtocol;
  priority: number;
}

export interface SourceItem {
  id: string;
  title: string;
  uris: SourceUri[];
  uploadDate?: string | null;
  fileSize?: string | null;
}

export interface SourceCatalog {
  id: string;
  name: string;
  sourceUrl?: string | null;
  importedAt: string;
  downloads: SourceItem[];
  sync?: {
    etag?: string | null;
    lastModified?: string | null;
    contentHash?: string | null;
    lastCheckedAt?: string | null;
    lastSyncedAt?: string | null;
    syncError?: string | null;
  } | null;
}

export interface RemoteSourceConfig {
  id: string;
  url: string;
  enabled: boolean;
  sync: {
    etag?: string | null;
    lastModified?: string | null;
    contentHash?: string | null;
    lastCheckedAt?: string | null;
    lastSyncedAt?: string | null;
    syncError?: string | null;
  };
}

export interface RemoteSyncItemResult {
  sourceId: string;
  url: string;
  success: boolean;
  updated: boolean;
  catalogId?: string | null;
  catalogName?: string | null;
  error?: string | null;
}

export interface RemoteSyncResult {
  total: number;
  updated: number;
  unchanged: number;
  failed: number;
  items: RemoteSyncItemResult[];
}

export interface SourceCatalogSummary {
  id: string;
  name: string;
  sourceUrl?: string | null;
  importedAt: string;
  downloadsCount: number;
}

export interface SourceItemsPage {
  sourceId: string;
  total: number;
  offset: number;
  limit: number;
  items: SourceItem[];
}

export interface SourceDownloadJob {
  jobId: string;
  sourceId: string;
  itemId: string;
  title: string;
  destinationDir: string;
  selectedUri: string;
  protocol: DownloadProtocol;
  status: SourceJobStatus;
  loaded: number;
  total: number;
  downloadSpeedBytes?: number;
  etaSeconds?: number | null;
  error?: string | null;
  externalId?: string | null;
  statusDetail?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceProgressPayload {
  jobId: string;
  title: string;
  protocol: DownloadProtocol;
  status: SourceJobStatus;
  loaded: number;
  total: number;
  downloadSpeedBytes?: number;
  etaSeconds?: number | null;
  externalId?: string | null;
  error?: string | null;
  statusDetail?: string | null;
}

export interface SourceMatchCandidate {
  sourceId: string;
  sourceName: string;
  itemId: string;
  itemTitle: string;
  score: number;
  protocols: DownloadProtocol[];
}

export interface SourceBestMatch {
  source_id: string;
  source_name: string;
  item_id: string;
  item_title: string;
  score: number;
  protocols: string[];
  file_size?: string | null;
  uris: SourceUri[];
}

export interface BatchImportItemResult {
  path: string;
  success: boolean;
  catalogId?: string | null;
  catalogName?: string | null;
  error?: string | null;
  wasUpdated: boolean;
}

export interface BatchImportResult {
  total: number;
  succeeded: number;
  failed: number;
  items: BatchImportItemResult[];
}

export function listSources(): Promise<SourceCatalog[]> {
  return invoke<SourceCatalog[]>("list_sources");
}

export function listSourcesSummary(): Promise<SourceCatalogSummary[]> {
  return invoke<SourceCatalogSummary[]>("list_sources_summary");
}

export function listSourceItemsPage(params: {
  sourceId: string;
  offset?: number | null;
  limit?: number | null;
}): Promise<SourceItemsPage> {
  return invoke<SourceItemsPage>("list_source_items_page", params);
}

export interface VerifiedSourcesStatus {
  total: number;
  installed: number;
  allInstalled: boolean;
  presetSources: RemoteSourceConfig[];
}

export function listRemoteSources(): Promise<RemoteSourceConfig[]> {
  return invoke<RemoteSourceConfig[]>("list_remote_sources");
}

export function getVerifiedSourcesStatus(): Promise<VerifiedSourcesStatus> {
  return invoke<VerifiedSourcesStatus>("get_verified_sources_status");
}

export function installVerifiedSources(syncNow = true): Promise<RemoteSyncResult> {
  return invoke<RemoteSyncResult>("install_verified_sources", { syncNow });
}

export function upsertRemoteSource(url: string, enabled?: boolean | null): Promise<RemoteSourceConfig> {
  return invoke<RemoteSourceConfig>("upsert_remote_source", { url, enabled: enabled ?? null });
}

export function removeRemoteSource(sourceId: string): Promise<void> {
  return invoke("remove_remote_source", { sourceId });
}

export function setRemoteSourceEnabled(sourceId: string, enabled: boolean): Promise<RemoteSourceConfig> {
  return invoke<RemoteSourceConfig>("set_remote_source_enabled", { sourceId, enabled });
}

export function syncRemoteSources(sourceIds?: string[] | null): Promise<RemoteSyncResult> {
  return invoke<RemoteSyncResult>("sync_remote_sources", { sourceIds: sourceIds ?? null });
}

export function removeSource(sourceId: string): Promise<void> {
  return invoke("remove_source", { sourceId });
}

export function importSourceFromFile(path: string, mode: ImportMode): Promise<SourceCatalog> {
  return invoke<SourceCatalog>("import_source_from_file", { path, mode });
}

export function importSourceFromUrl(url: string, mode: ImportMode): Promise<SourceCatalog> {
  return invoke<SourceCatalog>("import_source_from_url", { url, mode });
}

export function importSourcesFromFilesBatch(paths: string[], mode: ImportMode): Promise<BatchImportResult> {
  return invoke<BatchImportResult>("import_sources_from_files_batch", { paths, mode });
}

export function exportSourcesToJson(destinationPath?: string | null): Promise<string> {
  return invoke<string>("export_sources_to_json", { destinationPath: destinationPath ?? null });
}

export function exportSourceToJson(sourceId: string, destinationPath?: string | null): Promise<string> {
  return invoke<string>("export_source_to_json", { sourceId, destinationPath: destinationPath ?? null });
}

export function listSourceDownloadJobs(): Promise<SourceDownloadJob[]> {
  return invoke<SourceDownloadJob[]>("list_source_download_jobs");
}

export function startSourceDownload(params: {
  sourceId: string;
  itemId: string;
  destinationDir: string;
  preferredProtocol?: DownloadProtocol | null;
  selectedUri?: string | null;
}): Promise<string> {
  return invoke<string>("start_source_download", params);
}

export function cancelSourceDownload(jobId: string): Promise<void> {
  return invoke("cancel_source_download", { jobId });
}

export function pauseSourceDownload(jobId: string): Promise<void> {
  return invoke("pause_source_download", { jobId });
}

export function resumeSourceDownload(jobId: string): Promise<void> {
  return invoke("resume_source_download", { jobId });
}

export function sourcesFindMatchForGame(gameName: string, threshold?: number | null): Promise<SourceBestMatch[]> {
  return invoke<SourceBestMatch[]>("sources_find_match_for_game", { gameName, threshold: threshold ?? null });
}

export function sourcesFindMatchesBatch(gameNames: string[], threshold?: number | null): Promise<SourceBestMatch[]> {
  if (!gameNames.length) return Promise.resolve([]);
  return invoke<SourceBestMatch[]>("sources_find_matches_batch", { gameNames, threshold: threshold ?? null });
}
