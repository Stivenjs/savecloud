use futures_util::stream::{self, StreamExt};
use std::future::Future;
use std::sync::Arc;
use tokio::sync::mpsc;

pub type DownloadResult<T> = (usize, String, Result<T, String>);

pub fn start_download_pipeline<T, F, Fut>(
    keys: Vec<String>,
    concurrency: usize,
    download: F,
) -> (
    mpsc::Receiver<DownloadResult<T>>,
    tokio::task::JoinHandle<()>,
)
where
    T: Send + 'static,
    F: Fn(usize, String) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = DownloadResult<T>> + Send + 'static,
{
    let concurrency = concurrency.max(1);
    let (sender, receiver) = mpsc::channel(concurrency.saturating_mul(2).max(1));
    let download = Arc::new(download);
    let producer = tokio::spawn(async move {
        stream::iter(keys.into_iter().enumerate())
            .for_each_concurrent(concurrency, |(index, key)| {
                let sender = sender.clone();
                let download = Arc::clone(&download);
                async move {
                    let result = download(index, key).await;
                    let _ = sender.send(result).await;
                }
            })
            .await;
    });

    (receiver, producer)
}

pub async fn download_with_retries<T, F, Fut>(
    index: usize,
    key: String,
    url: Option<String>,
    kind: &str,
    download: F,
) -> DownloadResult<T>
where
    F: Fn(String, String) -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    let Some(url) = url else {
        return (
            index,
            key.clone(),
            Err(format!("No se obtuvo URL de descarga para {kind} {key}")),
        );
    };

    let mut attempt = 0_u32;
    loop {
        match download(key.clone(), url.clone()).await {
            Ok(value) => return (index, key, Ok(value)),
            Err(error) if attempt < 2 => {
                log::warn!(
                    "[steam-seed] Reintento {} para {} {}: {}",
                    attempt + 1,
                    kind,
                    key,
                    error
                );
                tokio::time::sleep(std::time::Duration::from_millis(500 << attempt)).await;
                attempt += 1;
            }
            Err(error) => {
                return (
                    index,
                    key.clone(),
                    Err(format!("Error en {kind} {key}: {error}")),
                );
            }
        }
    }
}
