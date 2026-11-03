use super::api::*;
use super::db::*;
use super::request::{seed_api_request, validate_presigned_url};
use super::types::*;
use crate::cloud::api_error;
use crate::network::DATA_CLIENT;
use crate::sqlite::AppDb;
use crate::steam_catalog::trending::sync_store_trending;
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn sync_export_steam_manifest_to_cloud_seed(
    db: State<'_, AppDb>,
    part_size: Option<u32>,
) -> Result<SteamSeedExportResultDto, String> {
    let db_ref = db.inner().clone();

    let _ = sync_store_trending(&db_ref).await;

    let db_manifest = db.inner().clone();
    let app_ids =
        tokio::task::spawn_blocking(move || db_manifest.with_conn(list_all_catalog_app_ids))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    if app_ids.is_empty() {
        return Ok(SteamSeedExportResultDto {
            app_ids_exported: 0,
            parts_uploaded: 0,
            priority_ids_uploaded: 0,
        });
    }

    let size = part_size.unwrap_or(50_000).clamp(1, 100_000) as usize;
    let mut parts_uploaded: u32 = 0;

    for (part_index, chunk) in app_ids.chunks(size).enumerate() {
        let body = serde_json::json!({ "partIndex": part_index as u32 }).to_string();
        let res = seed_api_request(
            reqwest::Method::POST,
            "/steam-seed/manifest/upload-url",
            Some(body.as_bytes()),
        )
        .await
        .map_err(|e| format!("manifest/upload-url: {}", e))?;

        if !res.status().is_success() {
            return Err(api_error::response_message(res).await);
        }

        let upload: SteamSeedUploadUrlResponse = res.json().await.map_err(|e| e.to_string())?;
        validate_presigned_url(&upload.upload_url)?;
        let mut payload = chunk
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        payload.push('\n');

        let put = DATA_CLIENT
            .put(&upload.upload_url)
            .header("Content-Type", "text/plain; charset=utf-8")
            .body(payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !put.status().is_success() {
            return Err(format!(
                "El almacenamiento rechazó la parte {} del manifiesto (HTTP {}).",
                part_index,
                put.status(),
            ));
        }
        parts_uploaded += 1;
    }

    let db_trending = db.inner().clone();
    let trending_ids =
        tokio::task::spawn_blocking(move || db_trending.with_conn(list_trending_app_ids))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    // El seed compartido debe contener popularidad global de Steam, no la biblioteca
    // privada del usuario que exporta el manifiesto.
    let priority_ids = trending_ids;

    let priority_url_res = seed_api_request(
        reqwest::Method::POST,
        "/steam-seed/priority/upload-url",
        None,
    )
    .await
    .map_err(|e| format!("priority/upload-url: {}", e))?;

    if !priority_url_res.status().is_success() {
        return Err(api_error::response_message(priority_url_res).await);
    }

    let priority_upload: SteamSeedUploadUrlResponse =
        priority_url_res.json().await.map_err(|e| e.to_string())?;
    validate_presigned_url(&priority_upload.upload_url)?;

    let priority_payload = if priority_ids.is_empty() {
        String::new()
    } else {
        let mut s = priority_ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        s.push('\n');
        s
    };

    let put_priority = DATA_CLIENT
        .put(&priority_upload.upload_url)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(priority_payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !put_priority.status().is_success() {
        return Err(format!(
            "El almacenamiento rechazó la lista prioritaria (HTTP {}).",
            put_priority.status()
        ));
    }

    Ok(SteamSeedExportResultDto {
        app_ids_exported: app_ids.len() as u32,
        parts_uploaded,
        priority_ids_uploaded: priority_ids.len() as u32,
    })
}

#[tauri::command]
pub async fn sync_reset_cloud_seed_state() -> Result<(), String> {
    let res = seed_api_request(reqwest::Method::POST, "/steam-seed/reset", None)
        .await
        .map_err(|e| format!("steam-seed/reset: {}", e))?;

    if !res.status().is_success() && res.status().as_u16() != 204 {
        return Err(api_error::response_message(res).await);
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_import_cloud_seed_batches_to_sqlite(
    app: AppHandle,
    db: State<'_, AppDb>,
    max_batches: Option<u32>,
    strategy: Option<String>,
    concurrency: Option<u32>,
) -> Result<SteamSeedImportResultDto, String> {
    let max_batches = max_batches.unwrap_or(500).clamp(1, 2000);
    let concurrency = concurrency.unwrap_or(12).clamp(1, 128) as usize;
    let requested_strategy = super::parse_import_strategy(strategy.as_deref())?;
    let started_at = Instant::now();

    super::import_cloud_seed_one_round(
        Some(&app),
        db.inner(),
        max_batches,
        &requested_strategy,
        concurrency,
        1,
        0,
        0,
        started_at,
    )
    .await
}

#[tauri::command]
pub async fn sync_import_cloud_seed_run_until_done(
    app: AppHandle,
    db: State<'_, AppDb>,
    max_batches: Option<u32>,
    strategy: Option<String>,
    concurrency: Option<u32>,
) -> Result<SteamSeedImportRunResultDto, String> {
    let max_batches = max_batches.unwrap_or(500).clamp(1, 2000);
    let concurrency = concurrency.unwrap_or(8).clamp(1, 128) as usize;
    let requested_strategy = super::parse_import_strategy(strategy.as_deref())?;

    let mut total_batches = 0u32;
    let mut total_rows = 0u32;
    let mut round = 0u32;
    let started_at = Instant::now();

    loop {
        round += 1;
        if round > super::STEAM_SEED_IMPORT_MAX_ROUNDS {
            return Err(
                "Se alcanzó el límite de repeticiones. Prueba de nuevo más tarde.".to_string(),
            );
        }

        let r = super::import_cloud_seed_one_round(
            Some(&app),
            db.inner(),
            max_batches,
            &requested_strategy,
            concurrency,
            round,
            total_batches,
            total_rows,
            started_at,
        )
        .await?;

        total_batches = total_batches.saturating_add(r.batches_processed);
        total_rows = total_rows.saturating_add(r.rows_updated);

        if r.batches_processed == 0 {
            break;
        }
    }

    let _ = app.emit(
        "steam-seed-import-progress",
        SteamSeedImportProgressPayload {
            iteration: round,
            batches_this_round: 0,
            rows_this_round: 0,
            total_batches,
            total_rows_updated: total_rows,
            status_text: Some("Optimizando motor de búsqueda...".to_string()),
            current_batch: None,
            done: false,
            elapsed_seconds: started_at.elapsed().as_secs(),
            eta_seconds: None,
        },
    );

    let db_opt = db.inner().clone();
    let _ = tokio::task::spawn_blocking(move || {
        let _ = db_opt.with_conn(|conn| {
            conn.execute(
                "INSERT INTO steam_catalog_search(steam_catalog_search) VALUES('optimize')",
                [],
            )
        });
    })
    .await;

    let _ = app.emit(
        "steam-seed-import-progress",
        SteamSeedImportProgressPayload {
            iteration: round,
            batches_this_round: 0,
            rows_this_round: 0,
            total_batches,
            total_rows_updated: total_rows,
            status_text: Some("Sincronización de catálogo finalizada.".to_string()),
            current_batch: None,
            done: true,
            elapsed_seconds: started_at.elapsed().as_secs(),
            eta_seconds: Some(0),
        },
    );

    let trending_priority_entries = sync_apply_cloud_priority_trending(db.inner())
        .await
        .unwrap_or(0);

    crate::steam_catalog::commands::listing::invalidate_facets_cache();
    let _ = app.emit("steam-catalog-updated", ());

    Ok(SteamSeedImportRunResultDto {
        rounds: round,
        batches_processed: total_batches,
        rows_updated: total_rows,
        trending_priority_entries: trending_priority_entries as u32,
    })
}

#[tauri::command]
pub async fn sync_get_steam_seed_freshness(
    db: State<'_, AppDb>,
) -> Result<SteamSeedFreshnessDto, String> {
    let db_load = db.inner().clone();
    let local_max = match tokio::task::spawn_blocking(move || {
        db_load.with_conn(|conn| {
            let s = load_or_init_import_state(conn)?;
            Ok::<_, rusqlite::Error>(super::effective_local_max_imported(&s))
        })
    })
    .await
    {
        Ok(Ok(max)) => max,
        Ok(Err(e)) => {
            return Ok(SteamSeedFreshnessDto {
                status: "unknown".to_string(),
                cloud_last_batch_key: None,
                local_max_batch_key: None,
                error: Some(e.to_string()),
            })
        }
        Err(e) => {
            return Ok(SteamSeedFreshnessDto {
                status: "unknown".to_string(),
                cloud_last_batch_key: None,
                local_max_batch_key: None,
                error: Some(e.to_string()),
            })
        }
    };

    let list_res = match seed_api_request(reqwest::Method::GET, "/steam-seed/status", None).await {
        Ok(r) => r,
        Err(e) => {
            return Ok(SteamSeedFreshnessDto {
                status: "unknown".to_string(),
                cloud_last_batch_key: None,
                local_max_batch_key: local_max,
                error: Some(e),
            });
        }
    };

    if !list_res.status().is_success() {
        let error = api_error::response_message(list_res).await;
        return Ok(SteamSeedFreshnessDto {
            status: "unknown".to_string(),
            cloud_last_batch_key: None,
            local_max_batch_key: local_max,
            error: Some(error),
        });
    }

    let remote: SteamSeedRemoteStatusDto = match list_res.json().await {
        Ok(x) => x,
        Err(e) => {
            return Ok(SteamSeedFreshnessDto {
                status: "unknown".to_string(),
                cloud_last_batch_key: None,
                local_max_batch_key: local_max,
                error: Some(e.to_string()),
            });
        }
    };

    let cloud_last = remote.last_batch_key;
    let local_for_compare =
        super::local_max_if_same_scope_as_cloud(cloud_last.as_deref(), local_max.as_deref());
    let status =
        super::compute_steam_seed_freshness_status(cloud_last.as_deref(), local_for_compare)
            .to_string();

    Ok(SteamSeedFreshnessDto {
        status,
        cloud_last_batch_key: cloud_last,
        local_max_batch_key: local_max,
        error: None,
    })
}

#[tauri::command]
pub async fn sync_get_steam_seed_worker_control(
) -> Result<Option<SteamSeedWorkerControlDto>, String> {
    let response = seed_api_request(reqwest::Method::GET, "/steam-seed/control", None)
        .await
        .map_err(|error| format!("steam-seed/control: {error}"))?;

    if response.status() == reqwest::StatusCode::FORBIDDEN {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(api_error::response_message(response).await);
    }

    response
        .json::<SteamSeedWorkerControlDto>()
        .await
        .map(Some)
        .map_err(|error| format!("steam-seed/control: {error}"))
}

#[tauri::command]
pub async fn sync_set_steam_seed_worker_paused(
    paused: bool,
) -> Result<SteamSeedWorkerControlDto, String> {
    let body = serde_json::json!({ "paused": paused }).to_string();
    let response = seed_api_request(
        reqwest::Method::PUT,
        "/steam-seed/control",
        Some(body.as_bytes()),
    )
    .await
    .map_err(|error| format!("steam-seed/control: {error}"))?;

    if !response.status().is_success() {
        return Err(api_error::response_message(response).await);
    }

    response
        .json::<SteamSeedWorkerControlDto>()
        .await
        .map_err(|error| format!("steam-seed/control: {error}"))
}
