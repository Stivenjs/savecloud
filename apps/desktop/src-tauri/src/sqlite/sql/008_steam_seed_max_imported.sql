-- Máximo batch importado (clave S3 completa), para comparar con el worker sin depender solo de cursor/watermark.
ALTER TABLE steam_seed_import_state ADD COLUMN max_imported_batch_key TEXT;

UPDATE steam_seed_import_state
SET max_imported_batch_key = cursor_last_key
WHERE max_imported_batch_key IS NULL AND cursor_last_key IS NOT NULL;
