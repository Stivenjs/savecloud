use reqwest::Identity;
use std::fs;

#[tokio::test]
async fn test_launch() -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = dirs::data_dir()
        .unwrap()
        .join("SaveCloud")
        .join("client_certs");
    let cert_pem = fs::read_to_string(data_dir.join("client.crt"))?;
    let key_pem = fs::read_to_string(data_dir.join("client.key"))?;

    let combined = format!("{}\n{}", key_pem, cert_pem);
    let identity = Identity::from_pem(combined.as_bytes())?;

    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .danger_accept_invalid_certs(true)
        .identity(identity)
        .build()
        .unwrap();

    let url = "https://127.0.0.1:47989/launch?uniqueid=0123456789ABCDEF&uuid=12345678123456781234567812345678&appversion=7.1.431.0&appid=0&appname=Desktop&mode=1920x1080x60&rikey=0123456789ABCDEF0123456789ABCDEF&rikeyid=1&localAudioPlayMode=0";

    let res = client.get(url).send().await?;
    println!("Status: {}", res.status());
    println!("Body: {}", res.text().await?);

    Ok(())
}
