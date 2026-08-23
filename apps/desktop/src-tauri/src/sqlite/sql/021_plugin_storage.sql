-- Migración 021: Tabla de almacenamiento clave-valor para plugins Lua.
CREATE TABLE IF NOT EXISTS plugin_storage (
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (plugin_id, key)
);

CREATE INDEX IF NOT EXISTS idx_plugin_storage_plugin
  ON plugin_storage (plugin_id);
