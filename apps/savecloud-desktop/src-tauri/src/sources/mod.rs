//! Subsistema modular de fuentes y descargas híbridas.

pub mod commands;
pub mod domain;
pub mod events;
pub mod hosters;
pub mod http_runner;
pub mod parser;
pub mod queue;
pub mod store;
pub mod torrent_notify;
pub mod torrent_runner;

pub use torrent_notify::torrent_complete_notify;
