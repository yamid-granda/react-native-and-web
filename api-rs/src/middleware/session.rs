//! The `Authorization: Bearer` boundary.
//!
//! This is the whole authorisation story for the write path: a request either
//! arrives with a token that resolves to a live session, or it is a 401. There
//! is no cookie, no `middleware.ts`, and no client-side check standing in for
//! it — the client guard in `useRequireSession` exists only so an anonymous
//! visitor does not stare at an empty screen.

use axum::extract::FromRequestParts;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;

use crate::app::AppState;
use crate::auth::token::hash_token;
use crate::error::AppError;
use crate::store::StoreUser;

/// The caller, resolved from a bearer token.
///
/// Rejects identically for a missing header, a header that is not
/// `Bearer <token>`, an unknown token and an expired one — one `AppError`, one
/// body. Anything more specific would tell an attacker which of the four they
/// got right.
#[derive(Clone, Debug)]
pub struct AuthUser {
    pub user: StoreUser,
    /// The hashed token, so `POST /auth/logout` can delete exactly this row
    /// without re-deriving it.
    pub token_hash: String,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = bearer_token(&parts.headers).ok_or(AppError::Unauthorized)?;
        let token_hash = hash_token(token);

        let session =
            state.store.find_valid_session(&token_hash).await?.ok_or(AppError::Unauthorized)?;
        let user =
            state.store.find_user_by_id(&session.user_id).await?.ok_or(AppError::Unauthorized)?;

        Ok(AuthUser { user, token_hash })
    }
}

/// The raw token from an `Authorization: Bearer` header.
///
/// The scheme is matched case-insensitively (RFC 9110 says the scheme is
/// case-insensitive, and clients differ), but the token itself is not trimmed
/// or normalised: it is compared by hash, so "fixing" it up would only create
/// two tokens for one credential.
fn bearer_token(headers: &axum::http::HeaderMap) -> Option<&str> {
    let raw = headers.get(AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = raw.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case("bearer") {
        return None;
    }
    (!token.is_empty() && !token.chars().any(char::is_whitespace)).then_some(token)
}

#[cfg(test)]
mod tests {
    use axum::http::HeaderMap;

    use super::*;

    fn headers(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, value.parse().expect("header value"));
        headers
    }

    #[test]
    fn a_well_formed_bearer_header_yields_the_token() {
        assert_eq!(bearer_token(&headers("Bearer abc123")), Some("abc123"));
    }

    #[test]
    fn the_scheme_is_case_insensitive() {
        assert_eq!(bearer_token(&headers("bearer abc123")), Some("abc123"));
        assert_eq!(bearer_token(&headers("BEARER abc123")), Some("abc123"));
    }

    /// Every malformed shape has to be `None`, because they all answer 401.
    #[test]
    fn malformed_authorization_headers_are_rejected() {
        for value in ["", "abc123", "Basic abc123", "Bearer", "Bearer ", "Bearer  a"] {
            assert_eq!(bearer_token(&headers(value)), None, "{value:?} should not authenticate");
        }
        assert_eq!(bearer_token(&HeaderMap::new()), None, "absent header");
    }

    /// The token is used verbatim, and a sloppy header is refused rather than
    /// repaired — a repair would be a second way to spell one credential.
    #[test]
    fn a_token_containing_whitespace_is_refused() {
        assert_eq!(bearer_token(&headers("Bearer abc123")), Some("abc123"));
        assert_eq!(bearer_token(&headers("Bearer  abc123")), None);
        assert_eq!(bearer_token(&headers("Bearer abc 123")), None);
    }
}
