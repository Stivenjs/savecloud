//! Centro de notificaciones: persistencia SQLite, sync HTTP con API SaveCloud y hooks desde sync/torrent.

pub mod commands;
pub(crate) mod db;
mod models;
mod sync_http;
pub mod writer;
