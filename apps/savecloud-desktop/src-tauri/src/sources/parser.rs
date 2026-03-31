//! Parser y normalización de catálogos JSON heterogéneos.

use std::collections::HashMap;

use serde_json::Value;

use super::domain::{DownloadProtocol, SourceCatalog, SourceItem, SourceUri};

/// Convierte texto JSON en un catálogo normalizado.
///
/// Requiere como contrato mínimo el campo raíz `downloads[]`.
pub fn parse_catalog(raw: &str, source_url: Option<String>) -> Result<SourceCatalog, String> {
    let parsed: Value = serde_json::from_str(raw).map_err(|e| format!("JSON inválido: {e}"))?;
    let downloads = parsed
        .get("downloads")
        .and_then(Value::as_array)
        .ok_or_else(|| "Contrato inválido: falta `downloads[]` en la raíz".to_string())?;

    if downloads.is_empty() {
        return Err("Contrato inválido: `downloads[]` no puede estar vacío".to_string());
    }

    let source_name = parsed
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or("source");
    let source_id = slugify(source_name);

    let mut items: Vec<SourceItem> = Vec::new();
    for (idx, item) in downloads.iter().enumerate() {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let title = obj
            .get("title")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(ToOwned::to_owned);
        let uris = obj.get("uris").and_then(Value::as_array).cloned().unwrap_or_default();

        let Some(title) = title else {
            continue;
        };

        let mut normalized_uris: Vec<SourceUri> = Vec::new();
        for (priority, uri) in uris.iter().enumerate() {
            let Some(raw_uri) = uri.as_str() else {
                continue;
            };
            let trimmed = raw_uri.trim();
            if trimmed.is_empty() {
                continue;
            }
            normalized_uris.push(SourceUri {
                uri: trimmed.to_string(),
                protocol: infer_protocol(trimmed),
                priority,
            });
        }
        if normalized_uris.is_empty() {
            continue;
        }

        let mut metadata = HashMap::new();
        for (k, v) in obj {
            if k != "title" && k != "uris" && k != "uploadDate" && k != "fileSize" {
                metadata.insert(k.clone(), v.clone());
            }
        }

        items.push(SourceItem {
            id: format!("{source_id}-item-{idx}"),
            title,
            uris: normalized_uris,
            upload_date: obj
                .get("uploadDate")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            file_size: obj.get("fileSize").and_then(Value::as_str).map(ToOwned::to_owned),
            metadata,
        });
    }

    if items.is_empty() {
        return Err("No se encontraron items válidos en `downloads[]` (requiere `title` + `uris[]`)".to_string());
    }

    Ok(SourceCatalog {
        id: source_id,
        name: source_name.to_string(),
        source_url,
        imported_at: chrono::Utc::now().to_rfc3339(),
        downloads: items,
    })
}

/// Detecta protocolo en base a URI.
pub fn infer_protocol(uri: &str) -> DownloadProtocol {
    let lower = uri.to_ascii_lowercase();
    if lower.starts_with("magnet:") {
        DownloadProtocol::TorrentMagnet
    } else if lower.ends_with(".torrent") {
        DownloadProtocol::TorrentFile
    } else if lower.starts_with("http://") || lower.starts_with("https://") {
        DownloadProtocol::Http
    } else {
        DownloadProtocol::Unknown
    }
}

/// Genera un identificador amigable para URL/archivos.
pub fn slugify(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if (ch == ' ' || ch == '_' || ch == '-' || ch == '.') && !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}

