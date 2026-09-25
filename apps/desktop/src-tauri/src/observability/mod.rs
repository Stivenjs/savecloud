//! Panel de salud / observabilidad: métricas locales, snapshot IPC y utilidades.
mod metrics;
pub mod remote;
pub mod snapshot;

pub use metrics::{
    record_error, record_saves_api_timing,
};
