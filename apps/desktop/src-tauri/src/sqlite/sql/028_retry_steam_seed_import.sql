-- Reintenta el seed completo después de corregir la aceptación de batches parciales.
-- Los upserts son idempotentes; conservamos los datos existentes y solo reiniciamos
-- los cursores que podrían haber avanzado más allá de batches fallidos.
UPDATE steam_seed_import_state
SET strategy = 'cursor',
    cursor_last_key = NULL,
    newest_watermark = NULL,
    max_imported_batch_key = NULL,
    updated_at = unixepoch()
WHERE id = 1;

UPDATE steam_seed_reviews_import_state
SET strategy = 'cursor',
    cursor_last_key = NULL,
    newest_watermark = NULL,
    max_imported_batch_key = NULL,
    updated_at = unixepoch()
WHERE id = 1;
