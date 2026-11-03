pub mod invites;
#[expect(
    clippy::module_inception,
    reason = "Submódulo share dentro de carpeta share"
)]
pub mod share;
