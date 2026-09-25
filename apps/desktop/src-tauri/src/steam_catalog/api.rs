//! Cliente mínimo para [`IStoreService/GetAppList`](https://partner.steamgames.com/doc/webapi/IStoreService).
//!
//! Por defecto Steam solo devuelve ítems tipo "Game". Activamos todos los `include_*` documentados
//! (DLC, software, vídeos/series, hardware) para que la búsqueda local se acerque al catálogo visible en la tienda.
//! Aumenta filas en SQLite y el tiempo del primer sync completo.

use serde_json::Value;

use crate::network::get_steam_client;

use super::error::CatalogSyncError;

const GET_APP_LIST_URL: &str = "https://api.steampowered.com/IStoreService/GetAppList/v1/";
pub const MAX_RESULTS_PER_REQUEST: u32 = 50_000;

/// Debe coincidir con [`super::sync::CURRENT_APP_LIST_SCOPE`]: si cambian los flags, forzar sync completo otra vez.
pub const GET_APP_LIST_QUERY_INCLUDES: &str = "\
include_games=true\
&include_dlc=true\
&include_software=true\
&include_videos=true\
&include_hardware=true";

/// Una página de resultados: lista `(appid, nombre)` y si Steam indica más páginas.
pub async fn fetch_app_list_page(
    api_key: &str,
    last_appid: u32,
    if_modified_since: Option<u32>,
) -> Result<(Vec<(u32, String)>, bool), CatalogSyncError> {
    let mut url = format!(
        "{GET_APP_LIST_URL}?key={}&max_results={}&last_appid={}&{}",
        urlencoding::encode(api_key),
        MAX_RESULTS_PER_REQUEST.min(50_000),
        last_appid,
        GET_APP_LIST_QUERY_INCLUDES
    );
    if let Some(ts) = if_modified_since {
        url.push_str(&format!("&if_modified_since={ts}"));
    }

    let res = get_steam_client().get(url).send().await?;
    let status = res.status();
    if !status.is_success() {
        return Err(CatalogSyncError::HttpStatus(status.as_u16()));
    }

    let bytes = res
        .bytes()
        .await
        .map_err(|_| CatalogSyncError::InvalidResponse)?;

    tokio::task::spawn_blocking(move || {
        let body: Value =
            serde_json::from_slice(&bytes).map_err(|_| CatalogSyncError::InvalidResponse)?;
        parse_app_list_response(&body)
    })
    .await
    .expect("Panic en el worker thread de parseo JSON")
}

fn parse_app_id(v: &Value) -> Option<u32> {
    v.as_u64()
        .or_else(|| v.as_i64().map(|i| i as u64))
        .and_then(|n| u32::try_from(n).ok())
        .or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
}

/// Lee `have_more` con variantes que Steam a veces devuelve (bool, 0/1, strings).
fn parse_have_more_raw(response: &Value) -> Option<bool> {
    let v = response.get("have_more")?;
    if let Some(b) = v.as_bool() {
        return Some(b);
    }
    if let Some(n) = v.as_u64() {
        return Some(n != 0);
    }
    if let Some(n) = v.as_i64() {
        return Some(n != 0);
    }
    if let Some(s) = v.as_str() {
        return match s.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" => Some(true),
            "false" | "0" | "no" => Some(false),
            _ => None,
        };
    }
    None
}

/// Si el lote llega al tope `max_results`, debe haber otra página aunque `have_more` sea false u omitido (bug / ambigüedad de la API).
fn effective_have_more(explicit: Option<bool>, parsed_len: usize) -> bool {
    match explicit {
        Some(true) => true,
        Some(false) if parsed_len >= MAX_RESULTS_PER_REQUEST as usize => true,
        Some(false) => false,
        None if parsed_len >= MAX_RESULTS_PER_REQUEST as usize => true,
        None => false,
    }
}

fn parse_app_list_response(body: &Value) -> Result<(Vec<(u32, String)>, bool), CatalogSyncError> {
    let response = body
        .get("response")
        .ok_or(CatalogSyncError::InvalidResponse)?;

    // Con `if_modified_since`, Steam suele devolver `apps: null` o omitir `apps` cuando no hay cambios.
    let apps_arr: &[Value] = match response.get("apps") {
        Some(Value::Array(a)) => a,
        Some(Value::Null) | None => &[],
        Some(_) => return Err(CatalogSyncError::InvalidResponse),
    };

    let explicit_have_more = parse_have_more_raw(response);

    let mut out = Vec::with_capacity(apps_arr.len());
    for item in apps_arr {
        let Some(appid) = item.get("appid").and_then(parse_app_id) else {
            continue;
        };
        let mut name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        // Juegos nuevos a veces llegan con `name` vacío hasta que Steam rellena metadatos; antes los omitíamos y no aparecían en búsqueda.
        if name.is_empty() {
            name = format!("App {}", appid);
        }
        out.push((appid, name));
    }

    let have_more = effective_have_more(explicit_have_more, out.len());

    Ok((out, have_more))
}

#[cfg(test)]
mod have_more_tests {
    use super::effective_have_more;

    #[test]
    fn full_page_false_still_requests_next() {
        assert!(effective_have_more(Some(false), 50_000));
    }

    #[test]
    fn short_page_false_stops() {
        assert!(!effective_have_more(Some(false), 49_999));
    }

    #[test]
    fn explicit_true_always_true() {
        assert!(effective_have_more(Some(true), 1));
    }

    #[test]
    fn omitted_flag_full_page_continues() {
        assert!(effective_have_more(None, 50_000));
    }
}
