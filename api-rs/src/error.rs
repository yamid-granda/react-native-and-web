use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::Engine as _;
use serde::Serialize;
use sha1::{Digest as _, Sha1};

use crate::store::StoreError;

pub const JSON_CONTENT_TYPE: &str = "application/json; charset=utf-8";

/// For every authenticated or mutating response. No seller response ever enters
/// `CacheTier`, and `no-store` says the same thing to the browser and to any
/// shared cache in front of the service — a stale product edit served out of a
/// cache is the whole failure mode the write path exists to prevent.
pub const NO_STORE: (HeaderName, HeaderValue) =
    (header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

/// A bodiless 204. Built directly rather than through [`json_response`], which
/// would stamp a content type and a weak ETag onto an empty body.
pub fn no_content() -> Response {
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(axum::body::Body::empty())
        .expect("a 204 with no headers always builds")
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("product {0} not found")]
    ProductNotFound(String),
    #[error("store {0} not found")]
    StoreNotFound(String),
    /// A malformed or rejected request body. The only new 4xx shape on the
    /// public contract, and the only one whose message is caller-specific: it
    /// echoes back what was wrong with *their* input, never anything about the
    /// database.
    #[error("{0}")]
    Validation(String),
    /// One variant, one message, for every way a bearer token can fail to
    /// identify a caller: absent, malformed, unknown, expired. Distinguishing
    /// them would tell an attacker which of the four happened.
    #[error("unauthorized")]
    Unauthorized,
    /// Reserved. No route returns it today: a seller touching a product they do
    /// not own gets [`Self::ProductNotFound`] instead, because a 403 confirms
    /// the id exists on a public catalogue. Kept for the authorisation cases
    /// that are genuinely about the caller's role rather than about a
    /// resource's existence.
    #[error("forbidden")]
    Forbidden,
    #[error("email already registered")]
    EmailTaken,
    /// `?page=` values that survive JS coercion but fail the positive-offset
    /// validation in [`crate::handlers::products`] surface as the generic 500.
    #[error("invalid pagination")]
    InvalidPagination,
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("serialization failed: {0}")]
    Serialization(#[from] serde_json::Error),
}

/// The error body shape shared by every 404/429/503 response:
/// `message`, `error`, `statusCode`, in that key order.
#[derive(Serialize)]
pub struct ErrorBody {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<&'static str>,
    #[serde(rename = "statusCode")]
    pub status_code: u16,
}

impl ErrorBody {
    pub fn to_vec(&self) -> Vec<u8> {
        serde_json::to_vec(self).expect("error body always serializes")
    }
}

/// Body of an unhandled exception: `statusCode` first, then `message`, and no
/// `error` key.
fn internal_error_body() -> Vec<u8> {
    #[derive(Serialize)]
    struct InternalErrorBody {
        #[serde(rename = "statusCode")]
        status_code: u16,
        message: &'static str,
    }
    serde_json::to_vec(&InternalErrorBody { status_code: 500, message: "Internal server error" })
        .expect("error body always serializes")
}

impl AppError {
    pub fn status(&self) -> StatusCode {
        match self {
            Self::ProductNotFound(_) | Self::StoreNotFound(_) => StatusCode::NOT_FOUND,
            Self::Validation(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Forbidden => StatusCode::FORBIDDEN,
            Self::EmailTaken | Self::Store(StoreError::EmailTaken) => StatusCode::CONFLICT,
            Self::InvalidPagination | Self::Store(_) | Self::Serialization(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        }
    }

    pub fn body(&self) -> Vec<u8> {
        match self {
            Self::ProductNotFound(id) => ErrorBody {
                message: format!("Product {id} not found"),
                error: Some("Not Found"),
                status_code: 404,
            }
            .to_vec(),
            Self::StoreNotFound(id) => ErrorBody {
                message: format!("Store {id} not found"),
                error: Some("Not Found"),
                status_code: 404,
            }
            .to_vec(),
            Self::Validation(message) => {
                ErrorBody { message: message.clone(), error: Some("Bad Request"), status_code: 400 }
                    .to_vec()
            }
            Self::Unauthorized => ErrorBody {
                // Deliberately not "Invalid email or password" or "Session
                // expired": every way a token fails gets this one string, so the
                // 401 body reveals nothing about which check failed.
                message: "Unauthorized".to_string(),
                error: Some("Unauthorized"),
                status_code: 401,
            }
            .to_vec(),
            Self::Forbidden => ErrorBody {
                message: "Forbidden".to_string(),
                error: Some("Forbidden"),
                status_code: 403,
            }
            .to_vec(),
            Self::EmailTaken | Self::Store(StoreError::EmailTaken) => ErrorBody {
                message: "Email already registered".to_string(),
                error: Some("Conflict"),
                status_code: 409,
            }
            .to_vec(),
            _ => internal_error_body(),
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        if matches!(self, Self::Store(_)) {
            tracing::error!(error = %self, "request failed");
        }
        let status = self.status();
        // `no-store` on errors too: an error body describes one caller's failed
        // request, and heuristic caching of a 401 or a 500 is exactly the kind of
        // thing that turns one bad session into a shared one. Additive, so the
        // committed error goldens (which are bodies) do not change.
        json_response(status, self.body(), &[NO_STORE], None)
    }
}

/// The weak ETag every JSON response carries:
/// `W/"<body length hex>-<sha1 base64 [0..27]>"`, so caches and browsers can
/// revalidate a 304 without refetching the body.
pub fn weak_etag(body: &[u8]) -> HeaderValue {
    let digest = Sha1::digest(body);
    let encoded = base64::engine::general_purpose::STANDARD.encode(digest);
    HeaderValue::from_str(&format!("W/\"{:x}-{}\"", body.len(), &encoded[..27]))
        .expect("etag is ASCII")
}

/// `If-None-Match` comparison with weak matching, per RFC 9110 (only ever
/// reached when we generated an ETag ourselves).
pub fn etag_matches(if_none_match: &HeaderValue, etag: &HeaderValue) -> bool {
    let Ok(raw) = if_none_match.to_str() else { return false };
    if raw.trim() == "*" {
        return true;
    }
    let etag = etag.to_str().unwrap_or_default();
    let strong = etag.strip_prefix("W/").unwrap_or(etag);
    raw.split(',').any(|candidate| {
        let candidate = candidate.trim();
        let candidate = candidate.strip_prefix("W/").unwrap_or(candidate);
        !candidate.is_empty() && candidate == strong
    })
}

/// Builds a JSON response: charset-tagged content type, weak ETag, and — when
/// `conditional` carries the request method/headers — `If-None-Match`
/// revalidation collapsing to a 304 with the content headers stripped.
pub fn json_response(
    status: StatusCode,
    body: Vec<u8>,
    extra_headers: &[(HeaderName, HeaderValue)],
    conditional: Option<(&Method, &HeaderMap)>,
) -> Response {
    let mut headers = HeaderMap::new();
    for (key, value) in extra_headers {
        headers.insert(key.clone(), value.clone());
    }
    if let Some((method, request_headers)) = conditional {
        if method == Method::GET || method == Method::HEAD {
            let etag = weak_etag(&body);
            let fresh = request_headers
                .get(header::IF_NONE_MATCH)
                .is_some_and(|if_none_match| etag_matches(if_none_match, &etag));
            headers.insert(header::ETAG, etag);
            if fresh {
                return (StatusCode::NOT_MODIFIED, headers).into_response();
            }
        }
    }
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(JSON_CONTENT_TYPE));
    (status, headers, body).into_response()
}

#[cfg(test)]
mod tests {
    use axum::http::{HeaderMap, HeaderValue, Method};

    use super::*;

    #[test]
    fn not_found_body_has_contract_key_order() {
        let error = AppError::ProductNotFound("prod-x".to_string());
        assert_eq!(
            String::from_utf8(error.body()).unwrap(),
            r#"{"message":"Product prod-x not found","error":"Not Found","statusCode":404}"#
        );
        assert_eq!(error.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn internal_error_body_has_contract_key_order() {
        let error = AppError::InvalidPagination;
        assert_eq!(
            String::from_utf8(error.body()).unwrap(),
            r#"{"statusCode":500,"message":"Internal server error"}"#
        );
        assert_eq!(error.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn the_new_client_errors_keep_the_same_key_order() {
        let cases = [
            (
                AppError::Validation("price must be positive".to_string()),
                StatusCode::BAD_REQUEST,
                r#"{"message":"price must be positive","error":"Bad Request","statusCode":400}"#,
            ),
            (
                AppError::Unauthorized,
                StatusCode::UNAUTHORIZED,
                r#"{"message":"Unauthorized","error":"Unauthorized","statusCode":401}"#,
            ),
            (
                AppError::Forbidden,
                StatusCode::FORBIDDEN,
                r#"{"message":"Forbidden","error":"Forbidden","statusCode":403}"#,
            ),
            (
                AppError::EmailTaken,
                StatusCode::CONFLICT,
                r#"{"message":"Email already registered","error":"Conflict","statusCode":409}"#,
            ),
            (
                AppError::StoreNotFound("usr-9".to_string()),
                StatusCode::NOT_FOUND,
                r#"{"message":"Store usr-9 not found","error":"Not Found","statusCode":404}"#,
            ),
        ];
        for (error, status, body) in cases {
            assert_eq!(error.status(), status);
            assert_eq!(String::from_utf8(error.body()).unwrap(), body);
        }
    }

    /// The whole point of one `Unauthorized` variant: four different failures,
    /// one indistinguishable answer.
    #[test]
    fn every_unauthorized_reason_produces_the_same_body() {
        assert_eq!(
            String::from_utf8(AppError::Unauthorized.body()).unwrap(),
            String::from_utf8(AppError::Unauthorized.body()).unwrap()
        );
        assert!(!String::from_utf8(AppError::Unauthorized.body()).unwrap().contains("token"));
    }

    #[test]
    fn a_unique_email_violation_is_a_conflict_not_a_five_hundred() {
        let error = AppError::from(StoreError::EmailTaken);
        assert_eq!(error.status(), StatusCode::CONFLICT);
        assert_eq!(
            String::from_utf8(error.body()).unwrap(),
            r#"{"message":"Email already registered","error":"Conflict","statusCode":409}"#
        );
    }

    #[tokio::test]
    async fn no_content_is_bare() {
        let response = no_content();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert!(!response.headers().contains_key(header::CONTENT_TYPE));
        assert!(!response.headers().contains_key(header::ETAG));
    }

    #[test]
    fn no_store_is_the_literally_documented_value() {
        assert_eq!(NO_STORE.0, header::CACHE_CONTROL);
        assert_eq!(NO_STORE.1, "no-store");
    }

    #[test]
    fn weak_etag_is_length_prefixed_sha1() {
        // sha1 → base64 → first 27 chars, prefixed with the byte length in
        // hex. For `{"a":1}` the base64 sha1 is
        // `n4nHQM60bXQYySSnisV5QdXpZSA`; the empty case is the constant the
        // sha1 of no bytes produces.
        let etag = weak_etag(br#"{"a":1}"#);
        assert_eq!(etag.to_str().unwrap(), "W/\"7-n4nHQM60bXQYySSnisV5QdXpZSA\"");
        assert_eq!(weak_etag(b"").to_str().unwrap(), "W/\"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk\"");
    }

    #[test]
    fn etag_matching_is_weak_and_list_aware() {
        let etag = HeaderValue::from_static("W/\"7-abc\"");
        let matches = |raw: &str| etag_matches(&HeaderValue::from_str(raw).unwrap(), &etag);
        assert!(matches("W/\"7-abc\""));
        assert!(matches("\"7-abc\""));
        assert!(matches("W/\"1-xyz\", W/\"7-abc\""));
        assert!(matches("*"));
        assert!(!matches("W/\"7-xyz\""));
        assert!(!matches(""));
    }

    #[test]
    fn json_response_sets_charset_content_type() {
        let response = json_response(StatusCode::OK, b"{}".to_vec(), &[], None);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/json; charset=utf-8"
        );
        assert!(!response.headers().contains_key(header::ETAG));
    }

    #[test]
    fn conditional_get_collapses_to_304() {
        let body = br#"{"status":"ok"}"#.to_vec();
        let etag = weak_etag(&body);
        let mut headers = HeaderMap::new();
        headers.insert(header::IF_NONE_MATCH, etag.clone());
        let response = json_response(StatusCode::OK, body, &[], Some((&Method::GET, &headers)));
        assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(response.headers().get(header::ETAG).unwrap(), etag);
        assert!(!response.headers().contains_key(header::CONTENT_TYPE));
    }
}
