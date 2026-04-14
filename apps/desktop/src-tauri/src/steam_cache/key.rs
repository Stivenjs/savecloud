//! Validación de identificadores de aplicación Steam (solo dígitos).

/// Comprueba si `s` es un App ID Steam plausible (no vacío, solo ASCII dígitos).
#[must_use]
pub fn is_valid_steam_app_id(s: &str) -> bool {
    let t = s.trim();
    !t.is_empty() && t.chars().all(|c| c.is_ascii_digit())
}

/// Normaliza el identificador o devuelve `None` si no es válido.
#[must_use]
pub fn normalize_steam_app_id(input: &str) -> Option<String> {
    let t = input.trim().to_string();
    if is_valid_steam_app_id(&t) {
        Some(t)
    } else {
        None
    }
}
