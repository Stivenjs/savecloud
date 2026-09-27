//! Cifrado, migración y retención de las copias locales de configuración.

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use keyring::{Entry, Error as KeyringError};
use rand::rngs::OsRng;
use rand::RngCore;
use std::fs::{self, OpenOptions};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;
use zeroize::Zeroizing;

use super::backup_snapshot::sanitized_config_snapshot;
use super::models::Config;

const BACKUP_DIRECTORY: &str = "config-backups";
const BACKUP_KEY_SERVICE: &str = "savecloud_config_backup";
const BACKUP_KEY_ACCOUNT: &str = "local_encryption_key_v1";
const BACKUP_EXTENSION: &str = "scb";
pub const BACKUP_MAGIC: &[u8; 8] = b"SCBK0001";
const NONCE_LENGTH: usize = 12;
const KEY_LENGTH: usize = 32;
const MAX_BACKUPS: usize = 5;

fn backup_directory() -> Result<PathBuf, String> {
    let data_dir = crate::config::paths::data_dir()
        .ok_or_else(|| "No se pudo resolver el directorio de configuración".to_string())?;
    let parent = data_dir
        .parent()
        .ok_or_else(|| "No se pudo resolver el directorio de respaldos".to_string())?;
    Ok(parent.join(BACKUP_DIRECTORY))
}

fn encryption_key() -> Result<Zeroizing<[u8; KEY_LENGTH]>, String> {
    let entry = Entry::new(BACKUP_KEY_SERVICE, BACKUP_KEY_ACCOUNT)
        .map_err(|error| format!("No se pudo acceder al almacén seguro del sistema: {error}"))?;

    match entry.get_password() {
        Ok(encoded_key) => decode_key(&Zeroizing::new(encoded_key)),
        Err(KeyringError::NoEntry) => {
            let mut key = Zeroizing::new([0_u8; KEY_LENGTH]);
            OsRng.fill_bytes(&mut key[..]);
            let encoded_key = Zeroizing::new(hex::encode(&key[..]));
            entry.set_password(&encoded_key).map_err(|error| {
                format!("No se pudo guardar la clave en el almacén seguro: {error}")
            })?;
            Ok(key)
        }
        Err(error) => Err(format!(
            "No se pudo leer la clave del almacén seguro: {error}"
        )),
    }
}

fn decode_key(encoded_key: &str) -> Result<Zeroizing<[u8; KEY_LENGTH]>, String> {
    let decoded = Zeroizing::new(
        hex::decode(encoded_key).map_err(|error| format!("La clave local está dañada: {error}"))?,
    );
    if decoded.len() != KEY_LENGTH {
        return Err("La clave local tiene una longitud inválida".to_string());
    }

    let mut key = Zeroizing::new([0_u8; KEY_LENGTH]);
    key.copy_from_slice(&decoded);
    Ok(key)
}

fn encrypt(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let key = encryption_key()?;
    encrypt_with_key(plaintext, &key)
}

fn encrypt_with_key(plaintext: &[u8], key: &[u8; KEY_LENGTH]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(&key[..])
        .map_err(|_| "No se pudo preparar el cifrado del respaldo".to_string())?;
    let mut nonce = [0_u8; NONCE_LENGTH];
    OsRng.fill_bytes(&mut nonce);
    let compressed = Zeroizing::new(
        zstd::stream::encode_all(Cursor::new(plaintext), 3)
            .map_err(|error| format!("No se pudo comprimir el respaldo: {error}"))?,
    );
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &compressed,
                aad: BACKUP_MAGIC,
            },
        )
        .map_err(|_| "No se pudo cifrar el respaldo local".to_string())?;

    let mut output = Vec::with_capacity(BACKUP_MAGIC.len() + NONCE_LENGTH + ciphertext.len());
    output.extend_from_slice(BACKUP_MAGIC);
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

pub fn decrypt(bytes: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    if !bytes.starts_with(BACKUP_MAGIC) || bytes.len() < BACKUP_MAGIC.len() + NONCE_LENGTH + 16 {
        return Err("El respaldo local está dañado o usa un formato desconocido".to_string());
    }

    let key = encryption_key()?;
    decrypt_with_key(bytes, &key)
}

fn decrypt_with_key(bytes: &[u8], key: &[u8; KEY_LENGTH]) -> Result<Zeroizing<Vec<u8>>, String> {
    if !bytes.starts_with(BACKUP_MAGIC) || bytes.len() < BACKUP_MAGIC.len() + NONCE_LENGTH + 16 {
        return Err("El respaldo local está dañado o usa un formato desconocido".to_string());
    }

    let cipher = Aes256Gcm::new_from_slice(&key[..])
        .map_err(|_| "No se pudo preparar el descifrado del respaldo".to_string())?;
    let nonce_start = BACKUP_MAGIC.len();
    let ciphertext_start = nonce_start + NONCE_LENGTH;
    let compressed = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&bytes[nonce_start..ciphertext_start]),
                Payload {
                    msg: &bytes[ciphertext_start..],
                    aad: BACKUP_MAGIC,
                },
            )
            .map_err(|_| "No se pudo autenticar o descifrar el respaldo local".to_string())?,
    );
    let plaintext = zstd::stream::decode_all(Cursor::new(&compressed[..]))
        .map_err(|error| format!("No se pudo descomprimir el respaldo local: {error}"))?;

    Ok(Zeroizing::new(plaintext))
}

fn write_atomically(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "No se pudo resolver el directorio del respaldo".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("No se pudo crear el directorio: {error}"))?;

    let temp_path = parent.join(format!(".respaldo-{}.tmp", Uuid::new_v4()));
    let write_result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| format!("No se pudo crear el archivo temporal: {error}"))?;
        file.write_all(contents)
            .map_err(|error| format!("No se pudo escribir el respaldo cifrado: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("No se pudo confirmar el respaldo en disco: {error}"))?;
        fs::rename(&temp_path, path)
            .map_err(|error| format!("No se pudo finalizar el respaldo cifrado: {error}"))
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

fn verify_encrypted_copy(encrypted: &[u8], original: &[u8]) -> Result<(), String> {
    let decrypted = decrypt(encrypted)?;
    if decrypted.as_slice() != original {
        return Err("La verificación de la copia cifrada no coincide".to_string());
    }
    Ok(())
}

fn sanitize_legacy_json(bytes: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    let mut value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|error| format!("No se pudo validar un respaldo JSON antiguo: {error}"))?;
    remove_sensitive_fields(&mut value);
    serde_json::to_vec(&value)
        .map(Zeroizing::new)
        .map_err(|error| format!("No se pudo preparar la migración segura: {error}"))
}

fn remove_sensitive_fields(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(fields) => {
            fields.retain(|name, _| !is_sensitive_field(name));
            for nested in fields.values_mut() {
                remove_sensitive_fields(nested);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                remove_sensitive_fields(item);
            }
        }
        _ => {}
    }
}

fn is_sensitive_field(name: &str) -> bool {
    let normalized = name
        .chars()
        .filter(|character| *character != '_' && *character != '-')
        .flat_map(char::to_lowercase)
        .collect::<String>();
    [
        "apikey",
        "steamapikey",
        "steamwebapikey",
        "proxyurl",
        "password",
        "token",
        "secret",
        "credential",
        "authorization",
        "cookie",
    ]
    .iter()
    .any(|sensitive_name| normalized == *sensitive_name || normalized.ends_with(sensitive_name))
}

fn retain_recent_backups(directory: &Path) -> Result<(), String> {
    let mut backups = fs::read_dir(directory)
        .map_err(|error| format!("No se pudo leer el directorio de respaldos: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.path().extension().and_then(|value| value.to_str()) == Some(BACKUP_EXTENSION)
        })
        .collect::<Vec<_>>();

    backups.sort_by_key(|entry| {
        entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
    });
    let remove_count = backups.len().saturating_sub(MAX_BACKUPS);
    for backup in backups.into_iter().take(remove_count) {
        fs::remove_file(backup.path())
            .map_err(|error| format!("No se pudo eliminar un respaldo antiguo: {error}"))?;
    }
    Ok(())
}

/// Crea una copia cifrada de la configuración previa a una restauración.
pub fn create_before_restore(config: &Config) -> Result<PathBuf, String> {
    let directory = backup_directory()?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("No se pudo crear el directorio de respaldos: {error}"))?;

    let snapshot = sanitized_config_snapshot(config);
    let plaintext = Zeroizing::new(
        serde_json::to_vec(&snapshot)
            .map_err(|error| format!("No se pudo serializar la configuración: {error}"))?,
    );
    let encrypted = encrypt(&plaintext)?;
    let timestamp = chrono::Utc::now().format("%Y-%m-%d_%H-%M-%S");
    let path = directory.join(format!("config-{timestamp}-{}.scb", Uuid::new_v4()));

    write_atomically(&path, &encrypted)?;
    let persisted =
        fs::read(&path).map_err(|error| format!("No se pudo verificar el respaldo: {error}"))?;
    verify_encrypted_copy(&persisted, &plaintext)?;
    retain_recent_backups(&directory)?;

    Ok(path)
}

/// Convierte los respaldos JSON antiguos y borra cada original solo tras verificar su copia cifrada.
pub fn migrate_legacy_backups() -> Result<usize, String> {
    let directory = backup_directory()?;
    if !directory.exists() {
        return Ok(0);
    }

    let legacy_files = fs::read_dir(&directory)
        .map_err(|error| format!("No se pudo leer el directorio de respaldos: {error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
        .collect::<Vec<_>>();

    let mut migrated = 0;
    for legacy_path in legacy_files {
        let original = Zeroizing::new(
            fs::read(&legacy_path)
                .map_err(|error| format!("No se pudo leer un respaldo antiguo: {error}"))?,
        );
        let sanitized = sanitize_legacy_json(&original)?;
        let encrypted_path = legacy_path.with_extension(BACKUP_EXTENSION);
        let encrypted = if encrypted_path.exists() {
            fs::read(&encrypted_path)
                .map_err(|error| format!("No se pudo leer una migración previa: {error}"))?
        } else {
            let encrypted = encrypt(&sanitized)?;
            write_atomically(&encrypted_path, &encrypted)?;
            encrypted
        };

        verify_encrypted_copy(&encrypted, &sanitized)?;
        fs::remove_file(&legacy_path)
            .map_err(|error| format!("No se pudo retirar el respaldo JSON antiguo: {error}"))?;
        migrated += 1;
    }

    retain_recent_backups(&directory)?;
    Ok(migrated)
}

#[cfg(test)]
mod tests {
    use super::{decrypt_with_key, encrypt_with_key, sanitize_legacy_json};

    #[test]
    fn el_respaldo_cifrado_se_comprime_y_se_puede_recuperar() -> Result<(), String> {
        let key = [37_u8; 32];
        let original = br#"{"apiKey":"credencial","games":[{"id":"juego"}]}"#;
        let encrypted = encrypt_with_key(original, &key)?;

        assert!(!encrypted
            .windows(original.len())
            .any(|window| window == original));
        assert_eq!(decrypt_with_key(&encrypted, &key)?.as_slice(), original);
        Ok(())
    }

    #[test]
    fn el_respaldo_alterado_no_se_descifra() -> Result<(), String> {
        let key = [19_u8; 32];
        let mut encrypted = encrypt_with_key(b"configuracion", &key)?;
        let last_index = encrypted.len() - 1;
        encrypted[last_index] ^= 1;

        assert!(decrypt_with_key(&encrypted, &key).is_err());
        Ok(())
    }

    #[test]
    fn la_migracion_elimina_credenciales_sin_perder_la_configuracion() -> Result<(), String> {
        let legacy = br#"{"apiKey":"secreto","proxyUrl":"https://user:pass@proxy","steamWebApiKey":"steam","games":[{"id":"juego","access_token":"token"}]}"#;
        let migrated = sanitize_legacy_json(legacy)?;
        let content = std::str::from_utf8(&migrated).map_err(|error| error.to_string())?;

        assert!(content.contains("juego"));
        assert!(!content.contains("secreto"));
        assert!(!content.contains("user:pass"));
        assert!(!content.contains("steam"));
        assert!(!content.contains("token"));
        Ok(())
    }
}
