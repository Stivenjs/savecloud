-- Centro de notificaciones: eventos persistentes locales + cola de sync con backend.

CREATE TABLE IF NOT EXISTS notification_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  game_id TEXT,
  operation_id TEXT,
  status TEXT,
  reason_code TEXT,
  payload_json TEXT,
  dedup_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  read_at TEXT,
  dismissed_at TEXT,
  source_device_id TEXT,
  server_updated_at TEXT,
  pending_sync INTEGER NOT NULL DEFAULT 0,
  sync_version INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notification_user_created
  ON notification_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_user_pending
  ON notification_events (user_id, pending_sync);

CREATE INDEX IF NOT EXISTS idx_notification_dedup
  ON notification_events (user_id, dedup_key, created_at);

CREATE TABLE IF NOT EXISTS notification_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
