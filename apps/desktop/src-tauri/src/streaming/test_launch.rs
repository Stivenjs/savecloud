use reqwest::Identity;
use std::fs;

#[tokio::test]
async fn test_launch() -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = dirs::data_dir()
        .unwrap()
        .join("SaveCloud");
    let cert_pem = fs::read_to_string(data_dir.join("moonlight_client.pem"))?;
    let key_pem = fs::read_to_string(data_dir.join("moonlight_client.key"))?;

    let combined = format!("{}\n{}", key_pem, cert_pem);
    let identity = Identity::from_pem(combined.as_bytes())?;

    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .danger_accept_invalid_certs(true)
        .identity(identity)
        .build()
        .unwrap();

    let url = "https://localhost:47984/launch?uniqueid=0123456789ABCDEF&uuid=12345678123456781234567812345678&appversion=7.1.431.0&appid=0&appname=Desktop&mode=1920x1080x60&rikey=0123456789ABCDEF0123456789ABCDEF&rikeyid=1&localAudioPlayMode=0";

    let res = match client.get(url).send().await {
        Ok(r) => r,
        Err(e) => {
            println!("Reqwest Error: {:?}", e);
            if let Some(source) = std::error::Error::source(&e) {
                println!("Caused by: {:?}", source);
                let mut current = source;
                while let Some(next) = std::error::Error::source(current) {
                    println!("Caused by: {:?}", next);
                    current = next;
                }
            }
            return Err(e.into());
        }
    };
    println!("Status: {}", res.status());
    println!("Body: {}", res.text().await?);

    Ok(())
}
