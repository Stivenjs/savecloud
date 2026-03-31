//! VikingFile depende del backend Nimbus; no replicado en SaveCloud.

pub fn is_vikingfile_host(host: &str) -> bool {
    host.contains("vikingfile")
}
