//! DTOs cacheables devueltos por comandos Tauri y rellenados desde `steam_search`.

/// Quita el query string (p. ej. `?t=epoch` en CDN de Steam). Estabiliza claves de caché y filas en SQLite.
#[must_use]
pub fn normalize_steam_cdn_url(url: &str) -> String {
    if url.is_empty() {
        return String::new();
    }
    url.split_once('?')
        .map(|(base, _)| base.to_string())
        .unwrap_or_else(|| url.to_string())
}

/// Normaliza URLs de medios antes de guardar o devolver al frontend.
#[must_use]
pub fn normalize_steam_appdetails_media(mut m: SteamAppdetailsMedia) -> SteamAppdetailsMedia {
    m.media_urls = m
        .media_urls
        .into_iter()
        .map(|u| normalize_steam_cdn_url(&u))
        .collect();
    m.video_url = m.video_url.map(|u| normalize_steam_cdn_url(&u));
    m.capsule_image = m.capsule_image.map(|u| normalize_steam_cdn_url(&u));
    m
}

/// Normaliza `header_image` y el bloque `media` de una ficha completa.
#[must_use]
pub fn normalize_steam_app_details(mut d: SteamAppDetails) -> SteamAppDetails {
    d.header_image = normalize_steam_cdn_url(&d.header_image);
    d.media = normalize_steam_appdetails_media(d.media);
    d
}

/// Respuesta ligera de Store `appdetails`: galería, vídeo y metadatos de lista (nombre Steam, géneros).
///
/// Una sola petición con filtros `basic,screenshots,movies,genres` — sin ficha completa.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamAppdetailsMedia {
    pub media_urls: Vec<String>,
    pub video_url: Option<String>,
    #[serde(default)]
    pub genres: Vec<String>,
    /// Nombre en tienda (locale de la petición); puede vaciarse si el filtro no incluye `basic`.
    #[serde(default)]
    pub name: String,
    /// URL de la imagen de cápsula (icono pequeño, típicamente 231x87 o 184x69).
    #[serde(default)]
    pub capsule_image: Option<String>,
}

/// Ficha completa de una aplicación de Steam.
///
/// Incluye textos descriptivos, metadatos (desarrollador, editor, géneros,
/// fecha de lanzamiento) y medios asociados.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamAppDetails {
    pub name: String,
    pub short_description: String,
    pub detailed_description: String,
    pub header_image: String,
    pub developers: Vec<String>,
    pub publishers: Vec<String>,
    pub genres: Vec<String>,
    pub categories: Vec<String>,
    pub release_date: Option<String>,
    pub pc_requirements_minimum: Option<String>,
    pub pc_requirements_recommended: Option<String>,
    pub media: SteamAppdetailsMedia,
}

#[cfg(test)]
mod normalize_tests {
    use super::*;

    #[test]
    fn normalize_steam_cdn_url_strips_query() {
        assert_eq!(
            normalize_steam_cdn_url(
                "https://cdn.akamai.steamstatic.com/steam/apps/730/header.jpg?t=1770822722"
            ),
            "https://cdn.akamai.steamstatic.com/steam/apps/730/header.jpg"
        );
    }

    #[test]
    fn normalize_steam_cdn_url_keeps_path_without_query() {
        let u = "https://x/y.png";
        assert_eq!(normalize_steam_cdn_url(u), u);
    }
}
