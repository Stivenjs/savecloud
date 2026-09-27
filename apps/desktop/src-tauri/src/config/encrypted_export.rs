//! Formato cifrado y portable para exportaciones locales de configuración.

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::rngs::OsRng;
use rand::RngCore;
use zeroize::Zeroizing;

const MAGIC: &[u8; 8] = b"SCFG0001";
const MAGIC_PREFIX: &[u8; 4] = b"SCFG";
const SALT_LENGTH: usize = 16;
const NONCE_LENGTH: usize = 12;
const KEY_LENGTH: usize = 32;
const HEADER_LENGTH: usize = MAGIC.len() + SALT_LENGTH + NONCE_LENGTH;
const ARGON2_MEMORY_KIB: u32 = 19 * 1024;
const ARGON2_ITERATIONS: u32 = 2;
const ARGON2_PARALLELISM: u32 = 1;
pub const MIN_PASSWORD_LENGTH: usize = 12;
pub const PASSWORD_REQUIRED_MARKER: &str = "SAVECLOUD_CONFIG_PASSWORD_REQUIRED";

/// Cifra un JSON con una clave derivada de contraseña y devuelve el contenedor binario `.scx`.
pub fn encrypt_config_json(plaintext: &[u8], password: &str) -> Result<Vec<u8>, String> {
    validate_password(password)?;

    let mut salt = [0_u8; SALT_LENGTH];
    let mut nonce = [0_u8; NONCE_LENGTH];
    let mut rng = OsRng;
    rng.fill_bytes(&mut salt);
    rng.fill_bytes(&mut nonce);

    let key = derive_key(password, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key[..])
        .map_err(|_| "No se pudo preparar el cifrado de la exportación.".to_string())?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: MAGIC,
            },
        )
        .map_err(|_| "No se pudo cifrar la configuración.".to_string())?;

    let mut output = Vec::with_capacity(HEADER_LENGTH + ciphertext.len());
    output.extend_from_slice(MAGIC);
    output.extend_from_slice(&salt);
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

/// Descifra un contenedor `.scx`. Devuelve `None` para permitir importar JSON antiguos.
pub fn decrypt_config_export(
    bytes: &[u8],
    password: Option<&str>,
) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
    if !bytes.starts_with(MAGIC) {
        if bytes.starts_with(MAGIC_PREFIX) {
            return Err("Esta exportación de SaveCloud usa una versión no compatible.".into());
        }
        return Ok(None);
    }

    let password = password.ok_or_else(|| PASSWORD_REQUIRED_MARKER.to_string())?;
    if bytes.len() < HEADER_LENGTH + 16 {
        return Err("El archivo cifrado está incompleto o dañado.".into());
    }

    let salt_end = MAGIC.len() + SALT_LENGTH;
    let nonce_end = salt_end + NONCE_LENGTH;
    let salt = &bytes[MAGIC.len()..salt_end];
    let nonce = &bytes[salt_end..nonce_end];
    let ciphertext = &bytes[nonce_end..];

    let key = derive_key(password, salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key[..])
        .map_err(|_| "No se pudo preparar el descifrado de la exportación.".to_string())?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: MAGIC,
            },
        )
        .map_err(|_| "Contraseña incorrecta o archivo cifrado alterado.".to_string())?;

    Ok(Some(Zeroizing::new(plaintext)))
}

fn validate_password(password: &str) -> Result<(), String> {
    if password.chars().count() < MIN_PASSWORD_LENGTH {
        return Err(format!(
            "La contraseña debe tener al menos {} caracteres.",
            MIN_PASSWORD_LENGTH
        ));
    }
    Ok(())
}

fn derive_key(password: &str, salt: &[u8]) -> Result<Zeroizing<[u8; KEY_LENGTH]>, String> {
    let params = Params::new(
        ARGON2_MEMORY_KIB,
        ARGON2_ITERATIONS,
        ARGON2_PARALLELISM,
        Some(KEY_LENGTH),
    )
    .map_err(|_| "No se pudo configurar la derivación de clave.".to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0_u8; KEY_LENGTH]);
    argon2
        .hash_password_into(password.as_bytes(), salt, &mut key[..])
        .map_err(|_| "No se pudo derivar la clave de cifrado.".to_string())?;
    Ok(key)
}
