//! Catálogo Steam en SQLite: sync desde la Web API, consultas locales y enriquecimiento con Store `appdetails`.
//!
//! - **Sync** ([`sync`]): `IStoreService/GetAppList` → tabla `steam_catalog_apps` (id + nombre).
//! - **Consultas** ([`query`]): búsqueda por tokens sobre `name_normalized`, con ranking por [`scoring`].
//! - **Scoring** ([`scoring`]): `catalog_rank_score` derivado de `details_json` (recencia + calidad + medios).
//! - **Tendencia** ([`trending`]): listas públicas de la Store (`featuredcategories`) → tabla `steam_catalog_trending`.
//! - **Enriquecimiento** ([`enrichment`]): `appdetails` de la Store, persistido en `details_json` y caché RAM.
//!
//! ## Orden de presentación del catálogo
//!
//! `trending` (rank ASC) → `catalog_rank_score DESC` → `enriched_at DESC` → `app_id DESC`
//!
//! El score se calcula en Rust al importar cada batch y se persiste en la columna
//! `catalog_rank_score` de `steam_catalog_apps`, garantizando paginación estable y
//! calidad consistente en todas las páginas del listado.
//!
//! Requiere clave [Steam Web API](https://steamcommunity.com/dev/apikey): campo
//! `steamWebApiKey` en settings o variable de entorno `STEAM_WEB_API_KEY`.

mod api;
pub mod commands;
mod enrichment;
mod error;
pub mod meta;
pub mod normalize;
mod query;
pub mod scoring;
pub mod sync;
pub(crate) mod trending;
mod types;
