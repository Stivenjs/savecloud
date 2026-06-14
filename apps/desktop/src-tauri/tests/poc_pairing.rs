//! Prueba de concepto: Handshake de emparejamiento con Sunshine.
//!
//! Este test prueba la comunicación básica HTTPS con un host local de Sunshine
//! para iniciar el proceso de emparejamiento. El protocolo completo de GameStream
//! requiere intercambio de certificados X509 y cifrado AES.
//!
//! Para ejecutar este test, debes tener Sunshine corriendo en localhost o en la IP objetivo.
//! `cargo test --test poc_pairing -- --nocapture`

use reqwest::Client;
use std::time::Duration;

#[tokio::test]
#[ignore]
async fn test_sunshine_serverinfo() {
    let target_ip = "127.0.0.1";
    let url = format!("https://{}:47984/serverinfo", target_ip);

    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(5))
        .build()
        .expect("Fallo al construir cliente HTTP");

    println!("Conectando a Sunshine en: {}", url);

    let res = client.get(&url).send().await;

    match res {
        Ok(response) => {
            assert!(
                response.status().is_success(),
                "Sunshine retornó error HTTP"
            );
            let xml = response.text().await.unwrap();
            println!("Respuesta de Sunshine:\n{}", xml);

            // Verificamos que sea un XML de GameStream válido
            assert!(xml.contains("<root>"), "Respuesta inválida");
            assert!(xml.contains("<appversion>"), "No se encontró appversion");

            println!("POC completada: Conexión con Sunshine establecida.");
        }
        Err(e) => {
            panic!(
                "No se pudo conectar a Sunshine. ¿Está ejecutándose? Error: {}",
                e
            );
        }
    }
}
