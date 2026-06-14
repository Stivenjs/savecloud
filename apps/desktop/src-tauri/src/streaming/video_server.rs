use futures_util::{SinkExt, StreamExt};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

pub struct VideoServer {
    pub cancel: Arc<AtomicBool>,
}

impl VideoServer {
    pub fn new() -> Self {
        Self {
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn start(&self, mut rx: mpsc::Receiver<Vec<u8>>) -> Result<u16, String> {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind TCP: {}", e))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();

        log::info!("Video WS Server started on port {}", port);

        let cancel = self.cancel.clone();

        tokio::spawn(async move {
            loop {
                if cancel.load(Ordering::Relaxed) {
                    break;
                }
                if let Ok((stream, _addr)) = listener.accept().await {
                    if let Ok(mut ws_stream) = accept_async(stream).await {
                        log::info!("Video WS Client connected");

                        loop {
                            tokio::select! {
                                _ = async {
                                    while cancel.load(Ordering::Relaxed) {
                                        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                                    }
                                } => break,
                                frame = rx.recv() => {
                                    match frame {
                                        Some(data) => {
                                            if let Err(e) = ws_stream.send(Message::Binary(data.into())).await {
                                                log::error!("WS send error: {}", e);
                                                break;
                                            }
                                        }
                                        None => {
                                            log::info!("Video channel closed");
                                            return; 
                                        }
                                    }
                                }
                                msg = ws_stream.next() => {
                                    if let Some(Ok(Message::Close(_))) = msg {
                                        log::info!("Video WS Client closed");
                                        break;
                                    } else if msg.is_none() {
                                        log::info!("Video WS connection dropped");
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        Ok(port)
    }

    pub fn stop(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
}
