//! Transferencia LAN entre peers (mDNS + servidor HTTP + descarga streaming).

pub mod discovery;
mod poller;
pub mod runner;
pub mod server;
pub mod session;

pub use discovery::{probe_lan_devices, LanDeviceProbe};
pub use poller::{poll_and_serve_pending_sessions, spawn_pending_session_poller};
pub use runner::{run_peer_download, PeerDownloadParams};
