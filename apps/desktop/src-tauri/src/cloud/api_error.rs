use serde::Deserialize;

use crate::errors::AppError;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiProblem {
    code: Option<String>,
    detail: Option<String>,
    message: Option<String>,
    title: Option<String>,
    error: Option<String>,
    request_id: Option<String>,
}

/// Convierte el formato de error anterior de SaveCloud y el RFC 9457 al modelo
/// de error de comando serializable de Tauri.
pub async fn from_response(response: reqwest::Response) -> AppError {
    let status = response.status().as_u16();
    let header_request_id = response
        .headers()
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let body = response.text().await.unwrap_or_default();
    let problem = serde_json::from_str::<ApiProblem>(&body).unwrap_or_default();
    // La respuesta HTTP es autoritativa; un cuerpo malformado no debe cambiar su estado.
    let effective_status = status;
    let code = problem.code.unwrap_or_else(|| {
        if effective_status >= 500 {
            "INTERNAL_ERROR".to_string()
        } else {
            format!("HTTP_{effective_status}")
        }
    });

    let message = if effective_status >= 500 {
        "Ocurrió un error en el servidor. Inténtalo de nuevo más tarde.".to_string()
    } else {
        problem
            .detail
            .filter(|detail| !detail.trim().is_empty())
            .or(problem.message.filter(|message| !message.trim().is_empty()))
            .or(problem.title)
            .or(problem.error)
            .unwrap_or_else(|| format!("La solicitud no se pudo completar ({effective_status})."))
    };

    AppError::api(
        code,
        message,
        effective_status,
        problem.request_id.or(header_request_id),
    )
}

/// Serializa un error normalizado para comandos de Tauri heredados que aún devuelven `String`.
/// El asignador de la interfaz de usuario (UI mapper) reconoce este objeto, lo que permite una migración gradual
/// sin exponer los cuerpos de respuesta sin procesar en mensajes visibles para el usuario.
pub async fn response_message(response: reqwest::Response) -> String {
    serialize_error(from_response(response).await)
}

pub fn network_message() -> String {
    serialize_error(AppError::network())
}

pub fn invalid_response_message() -> String {
    serialize_error(AppError::new(
        "INVALID_RESPONSE",
        "El servidor devolvió una respuesta inválida.",
    ))
}

fn serialize_error(error: AppError) -> String {
    serde_json::to_string(&error).unwrap_or_else(|_| {
        "{\"code\":\"INTERNAL_ERROR\",\"message\":\"Ocurrió un error inesperado.\"}".to_string()
    })
}

pub async fn ensure_success(response: reqwest::Response) -> Result<reqwest::Response, AppError> {
    if response.status().is_success() {
        Ok(response)
    } else {
        Err(from_response(response).await)
    }
}

#[cfg(test)]
mod tests {
    use super::ApiProblem;

    #[test]
    fn parses_rfc_problem_with_legacy_compatibility_fields_together() {
        let body = r#"{
            "type":"about:blank",
            "title":"Forbidden",
            "status":403,
            "detail":"No puedes aceptar tu propia invitación.",
            "instance":"urn:savecloud:request:req-1",
            "code":"FORBIDDEN",
            "requestId":"req-1",
            "error":"Forbidden",
            "message":"No puedes aceptar tu propia invitación.",
            "statusCode":403
        }"#;

        let problem = serde_json::from_str::<ApiProblem>(body)
            .expect("RFC fields and legacy aliases should coexist");

        assert_eq!(problem.code.as_deref(), Some("FORBIDDEN"));
        assert_eq!(
            problem.detail.as_deref(),
            Some("No puedes aceptar tu propia invitación.")
        );
        assert_eq!(
            problem.message.as_deref(),
            Some("No puedes aceptar tu propia invitación.")
        );
        assert_eq!(problem.request_id.as_deref(), Some("req-1"));
    }

    #[test]
    fn still_parses_legacy_error_envelopes() {
        let body = r#"{"code":"INVALID_ARGUMENT","error":"Bad Request","message":"No puedes enviarte una invitación a ti mismo."}"#;
        let problem = serde_json::from_str::<ApiProblem>(body).expect("legacy fields should parse");

        assert_eq!(problem.code.as_deref(), Some("INVALID_ARGUMENT"));
        assert_eq!(
            problem.message.as_deref(),
            Some("No puedes enviarte una invitación a ti mismo.")
        );
        assert_eq!(problem.error.as_deref(), Some("Bad Request"));
    }
}
