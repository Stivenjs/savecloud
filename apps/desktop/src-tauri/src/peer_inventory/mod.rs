//! Inventario verificado de juegos instalados por dispositivo (manifiesto local + cloud).

mod game_key;
mod install_paths;
mod models;
pub mod publish;
mod scanner;
pub mod store;

pub use game_key::{game_key_for_catalog_steam, game_key_for_configured_game};
pub use install_paths::resolve_install_root;
pub use models::*;
pub use publish::{
    delete_cloud_inventory, list_providers_from_api, publish_local_inventory,
    GameProvidersResponseDto, InventoryFileDto,
};
pub use store::{load_local_manifest, resolve_device_id};
