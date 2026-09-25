/**
 * Contratos del panel de salud / observabilidad (alineados con IPC Tauri y API).
 */

export interface SyncApiSummary {
  readonly sampleCount: number;
  readonly errorCount: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
}

export interface HealthErrorEntry {
  readonly tsMs: number;
  readonly source: string;
  readonly message: string;
  readonly statusCode?: number | null;
}

export interface WsHealthBlock {
  readonly connected: boolean;
  readonly pendingQueueLen: number;
  readonly lastConnectedAtMs?: number | null;
  readonly lastDisconnectedAtMs?: number | null;
  readonly lastError?: string | null;
  readonly lastErrorAtMs?: number | null;
  readonly totalSuccessfulConnections: number;
}

export interface CloudConfigBlock {
  readonly configured: boolean;
  readonly hasApiBaseUrl: boolean;
  readonly hasWsUrl: boolean;
  readonly hasUserId: boolean;
  readonly hasApiCredentials: boolean;
  readonly apiBaseHostPreview?: string | null;
  readonly isGuestCloud: boolean;
}

export interface NotificationsHealthBlock {
  readonly unreadCount: number;
}

export interface SuggestedAction {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly actionKind?: string | null;
}

export interface DesktopHealthSnapshot {
  readonly generatedAtMs: number;
  readonly cloud: CloudConfigBlock;
  readonly ws: WsHealthBlock;
  readonly syncApi: SyncApiSummary;
  readonly recentErrors: readonly HealthErrorEntry[];
  readonly notifications: NotificationsHealthBlock;
  readonly debugLogPath?: string | null;
  readonly suggestedActions: readonly SuggestedAction[];
}

export type ObservabilitySeverity = "ok" | "warning" | "critical";

export interface ScopeSummaryDto {
  readonly requests: number;
  readonly errors: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly p99Ms?: number | null;
}

export interface RemotePathLatencyEntry {
  readonly route: string;
  readonly requests: number;
  readonly p95Ms: number | null;
  readonly p99Ms: number | null;
}

export interface RemotePathErrorEntry {
  readonly route: string;
  readonly errors: number;
  readonly errorRate: number;
  readonly topStatus: number | null;
}

export interface RemoteMetricsBucket {
  readonly tsEndMs: number;
  readonly requests: number;
  readonly errors: number;
  readonly p95Ms: number | null;
}

export interface RemoteMethodSummary {
  readonly requests: number;
  readonly errors: number;
  readonly p95Ms: number | null;
}

export interface RemoteStatusBreakdown {
  readonly classes: Partial<Record<"1xx" | "2xx" | "3xx" | "4xx" | "5xx", number>>;
  readonly granular: ReadonlyArray<{ readonly statusCode: number; readonly count: number }>;
}

export interface RemoteCoverage {
  readonly samplesInWindow: number;
  readonly oldestSampleAtMs: number | null;
  readonly newestSampleAtMs: number | null;
  readonly retentionLimit: number;
  readonly retainedSamples: number;
}

export interface RemoteObservabilitySummary {
  readonly generatedAt?: string;
  readonly window?: string;
  readonly totals?: {
    readonly requests?: number;
    readonly errors?: number;
    readonly errorRate?: number;
    readonly p50Ms?: number | null;
    readonly p95Ms?: number | null;
    readonly p99Ms?: number | null;
    readonly rpsAvg?: number;
  };
  readonly byScope?: Record<string, ScopeSummaryDto | { note?: string; requests: number; errors: number }>;
  readonly byMethod?: Record<string, RemoteMethodSummary>;
  readonly statusBreakdown?: RemoteStatusBreakdown;
  readonly topSlowPaths?: readonly RemotePathLatencyEntry[];
  readonly topErrorPaths?: readonly RemotePathErrorEntry[];
  readonly topReasonCodes?: ReadonlyArray<{ readonly reasonCode: string; readonly count: number }>;
  readonly buckets?: readonly RemoteMetricsBucket[];
  readonly coverage?: RemoteCoverage;
  readonly items?: readonly unknown[];
  readonly unreadCount?: number;
}

export interface MergedObservability {
  readonly local: DesktopHealthSnapshot;
  readonly remote: RemoteObservabilitySummary | null;
  readonly overallSeverity: ObservabilitySeverity;
  readonly mergedAtIso: string;
}
