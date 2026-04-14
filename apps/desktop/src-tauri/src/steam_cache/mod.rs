//! Caché centralizada para respuestas de la API pública de Steam (`appdetails`).
//!
//! # Diseño
//!
//! - **Acotada**: [`moka::sync::Cache`] con `max_capacity` fijo por tipo de dato, evitando
//!   crecimiento ilimitado frente a `HashMap` sin eviction.
//! - **Concurrente**: el crate `moka` está pensado para muchas lecturas concurrentes;
//!   no hace falta un `RwLock` global por mapa.
//! - **Claves seguras**: solo se aceptan App ID numéricos ([`key::is_valid_steam_app_id`])
//!   al insertar; las lecturas usan las mismas claves que ya validó `steam_search`.
//!
//! # Persistencia
//!
//! Este módulo no escribe a disco; una futura capa SQLite/catálogo puede coexistir
//! o reemplazar parte de la caché en memoria según política de producto.

mod key;
mod store;
mod types;

pub use key::normalize_steam_app_id;
pub use store::steam_api_cache;
pub use types::{
    normalize_steam_app_details, normalize_steam_appdetails_media, SteamAppDetails,
    SteamAppdetailsMedia,
};
