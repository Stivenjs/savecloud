//! Catálogo Steam en SQLite: sync desde la Web API, consultas locales y enriquecimiento con Store `appdetails`.
//!
//! - **Sync** ([`sync`]): `IStoreService/GetAppList` → tabla `steam_catalog_apps` (id + nombre).
//! - **Consultas** ([`query`]): búsqueda por tokens sobre `name_normalized`, relevancia y tendencia de tienda.
//! - **Tendencia** ([`trending`]): listas públicas de la Store (`featuredcategories`) → tabla `steam_catalog_trending`.
//! - **Enriquecimiento** ([`enrichment`]): `appdetails` de la Store, persistido en `details_json` y caché RAM.
//!
//! Requiere clave [Steam Web API](https://steamcommunity.com/dev/apikey): campo
//! `steamWebApiKey` en settings o variable de entorno `STEAM_WEB_API_KEY`.

mod api;
pub mod commands;
mod enrichment;
mod error;
mod meta;
pub mod normalize;
mod query;
pub mod sync;
pub(crate) mod trending;
mod types;
