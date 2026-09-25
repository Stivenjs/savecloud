-- Migración 024: Eliminar triggers y tabla virtual FTS5 no utilizada en source_items
-- La tabla virtual source_items_trigram y sus triggers producían un cuello de botella masivo
-- al forzar full table scans de FTS5 durante los DELETEs de catálogos sin ser utilizada por la app.

DROP TRIGGER IF EXISTS trg_source_items_trigram_insert;
DROP TRIGGER IF EXISTS trg_source_items_trigram_update;
DROP TRIGGER IF EXISTS trg_source_items_trigram_delete;
DROP TABLE IF EXISTS source_items_trigram;
