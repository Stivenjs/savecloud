//! Búsqueda de juegos en el manifiesto de Ludusavi por nombre.

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestSearchResult {
    pub steam_app_id: String,
    pub name: String,
}

/// Busca juegos en el manifiesto de Ludusavi cuyo nombre contenga el texto indicado.
#[tauri::command]
pub async fn search_manifest_games(query: String) -> Result<Vec<ManifestSearchResult>, String> {
    let q = query.trim().to_lowercase();
    // Requerir al menos 3 caracteres para no saturar la búsqueda
    if q.len() < 3 {
        return Ok(Vec::new());
    }

    #[cfg(not(target_os = "windows"))]
    {
        // En otras plataformas, el manifiesto no está integrado todavía.
        Ok(Vec::new())
    }

    #[cfg(target_os = "windows")]
    {
        use std::collections::HashSet;

        let index = match crate::manifest::load_manifest_index_async().await {
            Ok(idx) => idx,
            Err(e) => return Err(format!("Error al cargar el manifiesto: {}", e)),
        };

        let mut seen_ids = HashSet::new();
        let mut results = Vec::new();

        for (id, entry) in index.iter() {
            let name_lc = entry.name.to_lowercase();

            if name_lc.contains(&q) && seen_ids.insert(id.clone()) {
                results.push(ManifestSearchResult {
                    steam_app_id: id.clone(),
                    name: entry.name.clone(),
                });
            }
        }

        results.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(results)
    }
}
