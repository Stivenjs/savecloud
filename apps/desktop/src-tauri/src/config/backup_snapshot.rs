//! Prepara configuraciones para respaldos sin incluir credenciales locales.

use super::models::Config;

pub fn sanitized_config_snapshot(config: &Config) -> Config {
    let mut snapshot = config.clone();
    snapshot.api_key = None;
    snapshot.steam_web_api_key = None;
    snapshot.proxy_url = None;
    snapshot
}

#[cfg(test)]
mod tests {
    use super::sanitized_config_snapshot;
    use crate::config::models::Config;

    #[test]
    fn omite_credenciales_de_los_respaldos() -> Result<(), String> {
        let config = Config {
            api_key: Some("clave-api-privada".to_string()),
            steam_web_api_key: Some("steam-api-privada".to_string()),
            proxy_url: Some("https://usuario:clave@proxy.example".to_string()),
            ..Config::default()
        };

        let serialized = serde_json::to_string(&sanitized_config_snapshot(&config))
            .map_err(|error| error.to_string())?;

        assert!(!serialized.contains("clave-api-privada"));
        assert!(!serialized.contains("steam-api-privada"));
        assert!(!serialized.contains("usuario:clave"));
        assert!(!serialized.contains("steamWebApiKey"));
        Ok(())
    }
}
