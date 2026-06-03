//! Transferencia LAN entre peers (mDNS + servidor HTTP + descarga streaming).

pub mod discovery;
mod mdns_registry;
mod poller;
mod presence;
pub mod runner;
pub mod server;
pub mod session;

pub use discovery::{probe_lan_devices, LanDeviceProbe};
pub use poller::{poll_and_serve_pending_sessions, spawn_pending_session_poller};
pub use presence::{ensure_lan_presence, spawn_lan_presence_advertiser};
pub use runner::{run_peer_download, PeerDownloadParams};
