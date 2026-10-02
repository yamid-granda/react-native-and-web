use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use base64::Engine as _;
use serde::Serialize;
use sha1::{Digest as _, Sha1};

use crate::store::StoreError;

pub const JSON_CONTENT_TYPE: &str = "application/json; charset=utf-8";

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("product {0} not found")]
    ProductNotFound(String),
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
            Self::ProductNotFound(_) => StatusCode::NOT_FOUND,
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
        json_response(status, self.body(), &[], None)
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
