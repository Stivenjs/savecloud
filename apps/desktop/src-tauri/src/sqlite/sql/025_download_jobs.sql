-- Migracion 025: jobs de descarga persistidos en SQLite.
CREATE TABLE IF NOT EXISTS download_jobs (
    job_id TEXT PRIMARY KEY NOT NULL,
    source_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    title TEXT NOT NULL,
    destination_dir TEXT NOT NULL,
    selected_uri TEXT NOT NULL,
    protocol TEXT NOT NULL,
    status TEXT NOT NULL,
    loaded INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    download_speed_bytes INTEGER NOT NULL DEFAULT 0,
    eta_seconds INTEGER,
    error TEXT,
    external_id TEXT,
    output_file_name TEXT,
    status_detail TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_download_jobs_status ON download_jobs(status);
CREATE INDEX IF NOT EXISTS idx_download_jobs_external_id ON download_jobs(external_id);
CREATE INDEX IF NOT EXISTS idx_download_jobs_source_item ON download_jobs(source_id, item_id);