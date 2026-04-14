//! DTOs expuestos al frontend para listados del catálogo local.

/// Fila mínima alineada con [`crate::steam::steam_search::SteamSearchResult`] (camelCase).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogListItem {
    pub steam_app_id: String,
    pub name: String,
}

/// Página de resultados con total global (para virtualización / paginación en UI).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPage {
    pub total: u64,
    pub offset: u32,
    pub limit: u32,
    pub items: Vec<CatalogListItem>,
}

/// Entrada de faceta (género o etiqueta Steam) con recuento de apps enriquecidas.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFilterFacet {
    pub label: String,
    pub count: u64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFilterFacets {
    pub genres: Vec<CatalogFilterFacet>,
    pub tags: Vec<CatalogFilterFacet>,
}
