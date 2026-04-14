-- Ficha enriquecida (JSON serializado de SteamAppDetails) + marca de tiempo.
ALTER TABLE steam_catalog_apps ADD COLUMN details_json TEXT;
