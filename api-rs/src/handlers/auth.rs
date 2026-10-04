//! `/auth/*`: register, login, logout, and who-am-I.
//!
//! Every response here carries `Cache-Control: no-store`, and none of it touches
//! `CacheTier`. A session token is a credential; a cached one is a shared one.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};

use crate::app::AppState;
use crate::auth::password;
use crate::auth::token::{generate_token, hash_token, opaque_id};
use crate::error::{json_response, no_content, AppError, NO_STORE};
use crate::handlers::JsonBody;
use crate::middleware::AuthUser;
use crate::store::{normalize_email, NewUser, StoreUser};

/// Longest store name. Enough for "Amara's Vintage & Repair", short enough that
/// the store header stays one line on a phone.
const MAX_STORE_NAME_LENGTH: usize = 80;
/// argon2 has no practical input limit, but an unbounded body field is a free
/// memory-amplification lever, and 1 KiB is far beyond any real passphrase.
const MAX_PASSWORD_LENGTH: usize = 1024;
const MIN_PASSWORD_LENGTH: usize = 8;

#[derive(Deserialize)]
pub struct RegisterRequest {
    email: String,
    password: String,
    #[serde(rename = "storeName")]
    store_name: String,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    email: String,
    password: String,
}

/// The public shape of a seller: `{ id, email, storeName }`. No password hash, no
/// session rows, and no `createdAt` — this surface is about credentials, and
/// `GET /stores/{id}` is where the rest of the record lives.
#[derive(Serialize)]
pub struct UserJson {
    id: String,
    email: String,
    #[serde(rename = "storeName")]
    store_name: String,
}

impl From<&StoreUser> for UserJson {
    fn from(user: &StoreUser) -> Self {
        Self { id: user.id.clone(), email: user.email.clone(), store_name: user.store_name.clone() }
    }
}

#[derive(Serialize)]
struct SessionJson {
    token: String,
    user: UserJson,
}

pub async fn register(
    State(state): State<AppState>,
    JsonBody(request): JsonBody<RegisterRequest>,
) -> Result<Response, AppError> {
    let email = normalize_email(&request.email);
    validate_email(&email)?;
    validate_password(&request.password)?;
    let store_name = request.store_name.trim();
    if store_name.is_empty() {
        return Err(AppError::Validation("storeName is required".to_string()));
    }
    if store_name.chars().count() > MAX_STORE_NAME_LENGTH {
        return Err(AppError::Validation(format!(
            "storeName must be at most {MAX_STORE_NAME_LENGTH} characters"
        )));
    }

    // Deliberately outside any transaction: argon2 costs tens of milliseconds of
    // pure CPU, and holding a pool connection across that would shrink the
    // effective pool for every other request. The price is one wasted hash per
    // registration that turns out to be a duplicate.
    let password_hash = hash_off_thread(request.password).await?;

    let user = state
        .store
        .create_user(NewUser {
            id: opaque_id("usr_"),
            email,
            password_hash,
            store_name: store_name.to_string(),
        })
        .await?;

    let token = issue_token(&state, &user.id).await?;
    session(StatusCode::CREATED, token, &user)
}

pub async fn login(
    State(state): State<AppState>,
    JsonBody(request): JsonBody<LoginRequest>,
) -> Result<Response, AppError> {
    let email = normalize_email(&request.email);

    let record = state.store.find_user_by_email(&email).await?;

    // Verify against a real hash either way. Skipping the verify for an unknown
    // address would turn response time into a membership oracle: "this one took
    // 40 ms" would mean that address is registered.
    let stored_hash =
        record.as_ref().map_or_else(dummy_hash, |record| record.password_hash.clone());
    let password_matches = verify_off_thread(stored_hash, request.password).await?;

    let Some(record) = record.filter(|_| password_matches) else {
        metrics::counter!("auth_login_total", "result" => "invalid").increment(1);
        return Err(AppError::Unauthorized);
    };
    metrics::counter!("auth_login_total", "result" => "ok").increment(1);

    let token = issue_token(&state, &record.user.id).await?;
    session(StatusCode::OK, token, &record.user)
}

pub async fn logout(auth: AuthUser, State(state): State<AppState>) -> Result<Response, AppError> {
    // Deleting the row *is* the revocation: the next request carrying this token
    // fails the lookup and is a 401. A 204 even when the row was already gone, so
    // a double-tap is not an error the client has to model.
    state.store.delete_session(&auth.token_hash).await?;
    Ok(no_content())
}

pub async fn me(auth: AuthUser) -> Result<Response, AppError> {
    let bytes = serde_json::to_vec(&UserJson::from(&auth.user))?;
    Ok(json_response(StatusCode::OK, bytes, &[NO_STORE], None))
}

fn session(status: StatusCode, token: String, user: &StoreUser) -> Result<Response, AppError> {
    let bytes = serde_json::to_vec(&SessionJson { token, user: UserJson::from(user) })?;
    Ok(json_response(status, bytes, &[NO_STORE], None))
}

/// A fresh token, persisted as its hash. The raw token is handed to the caller
/// and then only ever compared by hash — it is written down nowhere.
async fn issue_token(state: &AppState, user_id: &str) -> Result<String, AppError> {
    let token = generate_token();
    // Reclaim this seller's dead rows before adding one. Every login and every
    // registration inserts a row and, before this, nothing removed one except a
    // logout — so the table was an append-only log of login events. Doing it
    // here costs one indexed DELETE on a path that is already a write and has
    // already paid for an argon2 hash, and needs no scheduler and no new config
    // key; a seller logging in again is exactly when their dead rows are worth
    // reclaiming.
    //
    // Fail-open, deliberately: the token below is minted either way. A row
    // already past its expiry cannot authenticate regardless of whether this
    // delete ran, so propagating the error would turn a housekeeping problem
    // into an outage.
    if let Err(error) = state.store.delete_expired_for_user(user_id).await {
        tracing::warn!(user_id, error = %error, "expired session cleanup failed");
        metrics::counter!("session_cleanup_errors_total").increment(1);
    }
    state
        .store
        .create_session(
            &hash_token(&token),
            user_id,
            session_expiry(&state.config.session_ttl_secs),
        )
        .await?;
    Ok(token)
}

fn session_expiry(ttl_secs: &u64) -> NaiveDateTime {
    chrono::Utc::now().naive_utc() + chrono::Duration::seconds(*ttl_secs as i64)
}

/// argon2 on a blocking thread.
///
/// Default parameters cost tens of milliseconds of pure CPU. On an async worker
/// that is a stall — the runtime has nothing else to run for that worker, and
/// `GLOBAL_CONCURRENCY_LIMIT` is the only thing bounding how many pile up — which
/// is also why `POST /auth/login` carries its own per-IP throttle.
async fn hash_off_thread(password: String) -> Result<String, AppError> {
    let hashed = tokio::task::spawn_blocking(move || password::hash_password(&password)).await;
    match hashed {
        Ok(Ok(hash)) => Ok(hash),
        // An argon2 failure here is a server configuration problem, not a bad
        // password, so it must not surface as the caller's fault.
        Ok(Err(error)) => Err(hash_failed(&error)),
        Err(error) => Err(hash_failed(&error.to_string())),
    }
}

async fn verify_off_thread(hash: String, password: String) -> Result<bool, AppError> {
    tokio::task::spawn_blocking(move || password::verify_password(&hash, &password)).await.map_err(
        |error| {
            tracing::error!(error = %error, "password verification task failed");
            internal("password verification task panicked")
        },
    )
}

fn hash_failed(error: &impl std::fmt::Display) -> AppError {
    tracing::error!(error = %error, "password hashing failed");
    internal("password hashing failed")
}

fn internal(message: &str) -> AppError {
    AppError::Store(crate::store::StoreError::Database(message.to_string()))
}

/// A real argon2 hash of an unguessable throwaway value, built once per process.
///
/// It is never returned to anyone and never matches a submitted password; its
/// only job is to cost the same CPU a registered account would, so `login` takes
/// the same time whether or not the address exists.
fn dummy_hash() -> String {
    static DUMMY: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    DUMMY
        .get_or_init(|| {
            password::hash_password(&opaque_id("dummy_"))
                .expect("hashing an unguessable throwaway value cannot fail")
        })
        .clone()
}

fn validate_email(email: &str) -> Result<(), AppError> {
    if email.is_empty() {
        return Err(AppError::Validation("email is required".to_string()));
    }
    // One `@`, something on both sides, a dotted domain, no whitespace. Not RFC
    // 5322: a full parser would accept addresses no provider issues, and the only
    // consumer of this field is a login form.
    let mut parts = email.split('@');
    let (local, domain) = (parts.next().unwrap_or_default(), parts.next().unwrap_or_default());
    let shape_is_wrong = parts.next().is_some()
        || local.is_empty()
        || domain.is_empty()
        || !domain.contains('.')
        || email.chars().any(char::is_whitespace);
    if shape_is_wrong {
        return Err(AppError::Validation("email is not a valid address".to_string()));
    }
    Ok(())
}

fn validate_password(password: &str) -> Result<(), AppError> {
    if password.chars().count() < MIN_PASSWORD_LENGTH {
        return Err(AppError::Validation(format!(
            "password must be at least {MIN_PASSWORD_LENGTH} characters"
        )));
    }
    if password.len() > MAX_PASSWORD_LENGTH {
        return Err(AppError::Validation(format!(
            "password must be at most {MAX_PASSWORD_LENGTH} bytes"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emails_must_look_like_addresses() {
        for good in ["a@b.co", "seller@example.com", "first.last+tag@sub.example.co.uk"] {
            assert!(validate_email(good).is_ok(), "{good} should be accepted");
        }
        for bad in [
            "",
            "no-at-sign",
            "@example.com",
            "seller@",
            "a@b@c.com",
            "seller@localhost",
            "a b@c.com",
        ] {
            assert!(validate_email(bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn password_length_is_bounded_at_both_ends() {
        assert!(validate_password("short").is_err());
        assert!(validate_password("12345678").is_ok());
        assert!(validate_password(&"x".repeat(MAX_PASSWORD_LENGTH)).is_ok());
        assert!(validate_password(&"x".repeat(MAX_PASSWORD_LENGTH + 1)).is_err());
    }

    #[test]
    fn the_public_user_shape_has_no_credential_in_it() {
        let user = StoreUser {
            id: "usr_1".to_string(),
            email: "seller@example.com".to_string(),
            store_name: "Corner Shop".to_string(),
            created_at: chrono::Utc::now().naive_utc(),
        };
        assert_eq!(
            serde_json::to_string(&UserJson::from(&user)).unwrap(),
            r#"{"id":"usr_1","email":"seller@example.com","storeName":"Corner Shop"}"#
        );
    }

    #[test]
    fn the_session_expiry_is_the_configured_window_from_now() {
        let delta = session_expiry(&3600) - chrono::Utc::now().naive_utc();
        assert!(delta.num_seconds() > 3595 && delta.num_seconds() <= 3600, "{delta:?}");
    }

    /// The timing equaliser only works if the throwaway hash is a genuine one.
    #[test]
    fn the_dummy_hash_is_a_real_argon2_hash_that_matches_nothing() {
        let hash = dummy_hash();
        assert!(hash.starts_with("$argon2id$"), "{hash}");
        assert!(!password::verify_password(&hash, "hunter42"));
        assert_eq!(hash, dummy_hash(), "built once and reused");
    }
}

#[cfg(test)]
mod handler_tests {
    use std::sync::Arc;

    use axum::body::Body;
    use axum::http::{header, Method, StatusCode};
    use axum::Router;
    use http_body_util::BodyExt;
    use serde_json::json;
    use tower::ServiceExt;

    use crate::app::{router, AppState};
    use crate::auth::token::hash_token;
    use crate::config::Config;
    use crate::store::{InMemoryStore, SessionStore, StoreOp};

    use super::*;

    /// An app over a store whose session surface is on a handle the test can
    /// break, which is how the handler tests reach a store error without Docker.
    fn app_with_store() -> (Router, InMemoryStore) {
        // Cheap argon2 for the whole suite: it registers, logs in and verifies
        // dozens of times, and at production parameters that is the slowest thing
        // in `cargo test --lib` by an order of magnitude.
        password::use_cheap_params_for_tests();
        let store = InMemoryStore::default();
        let state = AppState::new(Config::default(), Arc::new(store.clone()), None, None);
        (router(state), store)
    }

    fn app() -> Router {
        app_with_store().0
    }

    async fn body(response: Response) -> serde_json::Value {
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).expect("json body")
    }

    async fn raw(response: Response) -> String {
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    fn json_request(
        method: Method,
        uri: &str,
        body: serde_json::Value,
    ) -> axum::http::Request<Body> {
        axum::http::Request::builder()
            .method(method)
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    fn register_body() -> serde_json::Value {
        serde_json::json!({
            "email": "Seller@Example.com",
            "password": "correct horse battery",
            "storeName": "  Riverbend Vintage  "
        })
    }

    async fn register(app: &Router, body: serde_json::Value) -> Response {
        app.clone().oneshot(json_request(Method::POST, "/auth/register", body)).await.unwrap()
    }

    /// Registers and returns the raw token.
    async fn sign_up(app: &Router) -> String {
        let response = register(app, register_body()).await;
        assert_eq!(response.status(), StatusCode::CREATED);
        assert_eq!(response.headers().get(header::CACHE_CONTROL).unwrap(), "no-store");
        body(response).await["token"].as_str().expect("token").to_string()
    }

    #[tokio::test]
    async fn register_normalises_the_email_and_trims_the_store_name() {
        let response = register(&app(), register_body()).await;
        assert_eq!(response.status(), StatusCode::CREATED);
        let json = body(response).await;
        assert_eq!(json["user"]["email"], "seller@example.com");
        assert_eq!(json["user"]["storeName"], "Riverbend Vintage");
        assert!(json["user"]["id"].as_str().expect("id").starts_with("usr_"));
        // No credential anywhere in the payload.
        assert!(!json.to_string().contains("argon2"));
    }

    /// The database is the thing that makes two concurrent registrations of one
    /// address impossible, so the losing insert has to reach the client as a 409
    /// rather than as a 500.
    #[tokio::test]
    async fn a_duplicate_email_is_a_conflict() {
        let app = app();
        sign_up(&app).await;

        let response = register(&app, register_body()).await;
        assert_eq!(response.status(), StatusCode::CONFLICT);
        assert_eq!(
            raw(response).await,
            r#"{"message":"Email already registered","error":"Conflict","statusCode":409}"#
        );
    }

    #[tokio::test]
    async fn the_same_email_in_a_different_case_is_still_a_conflict() {
        let app = app();
        sign_up(&app).await;
        let mut payload = register_body();
        payload["email"] = json!("SELLER@EXAMPLE.COM");
        assert_eq!(register(&app, payload).await.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn registration_validates_its_input() {
        let app = app();
        let cases = [
            (json!({ "email": "nope", "password": "correct horse", "storeName": "Shop" }), "email"),
            (
                json!({ "email": "seller@example.com", "password": "short", "storeName": "Shop" }),
                "password",
            ),
            (
                json!({ "email": "seller@example.com", "password": "correct horse", "storeName": "  " }),
                "storeName",
            ),
            (
                json!({ "email": "seller@example.com", "password": "correct horse", "storeName": "x".repeat(81) }),
                "storeName",
            ),
        ];
        for (payload, expected) in cases {
            let response = register(&app, payload).await;
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{expected}");
            let json = body(response).await;
            assert!(
                json["message"].as_str().expect("message").contains(expected),
                "{json} should name {expected}"
            );
        }
    }

    /// A missing field is a 400 in the contract's error shape, not axum's
    /// default `422` with a `text/plain` body.
    #[tokio::test]
    async fn a_malformed_body_is_a_json_400() {
        let response = app()
            .oneshot(json_request(Method::POST, "/auth/register", json!({ "email": "a@b.co" })))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/json; charset=utf-8"
        );
    }

    #[tokio::test]
    async fn login_is_case_insensitive_on_the_email() {
        let app = app();
        sign_up(&app).await;
        let response = app
            .clone()
            .oneshot(json_request(
                Method::POST,
                "/auth/login",
                json!({ "email": "  SELLER@EXAMPLE.COM ", "password": "correct horse battery" }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(body(response).await["user"]["storeName"], "Riverbend Vintage");
    }

    /// Reclaiming a seller's dead rows is housekeeping, so a failure there is
    /// warned about and counted, never propagated: the credential being minted
    /// is unaffected, and turning a cleanup error into a 500 would make a
    /// housekeeping problem an outage.
    ///
    /// `fail_once` rather than `fail_always` because the sweep and the insert
    /// share one surface: a one-shot failure lands on whichever runs first, and
    /// the sweep is deliberately first.
    #[tokio::test]
    async fn a_failed_session_cleanup_does_not_fail_the_login() {
        let (app, store) = app_with_store();
        let token = sign_up(&app).await;

        store.fail_once(StoreOp::Sessions);
        let response = app
            .clone()
            .oneshot(json_request(
                Method::POST,
                "/auth/login",
                json!({ "email": "seller@example.com", "password": "correct horse battery" }),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "the sweep failed, not the login");

        // The session it minted is a working one. That is the whole assertion: a
        // cleanup error costs dead weight, not a credential.
        let me = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/auth/me")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(me.status(), StatusCode::OK);
    }

    /// The two failures are indistinguishable in body *and* in status, so the
    /// endpoint cannot be used to enumerate which addresses are registered.
    #[tokio::test]
    async fn a_wrong_password_and_an_unknown_address_answer_identically() {
        let app = app();
        sign_up(&app).await;

        let wrong_password = app
            .clone()
            .oneshot(json_request(
                Method::POST,
                "/auth/login",
                json!({ "email": "seller@example.com", "password": "not the password" }),
            ))
            .await
            .unwrap();
        let unknown_address = app
            .clone()
            .oneshot(json_request(
                Method::POST,
                "/auth/login",
                json!({ "email": "nobody@example.com", "password": "not the password" }),
            ))
            .await
            .unwrap();

        assert_eq!(wrong_password.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(unknown_address.status(), wrong_password.status());
        let wrong_password_body = raw(wrong_password).await;
        assert_eq!(wrong_password_body, raw(unknown_address).await);
        assert_eq!(
            wrong_password_body,
            r#"{"message":"Unauthorized","error":"Unauthorized","statusCode":401}"#
        );
    }

    #[tokio::test]
    async fn me_returns_the_signed_in_seller() {
        let app = app();
        let token = sign_up(&app).await;
        let response = app
            .clone()
            .oneshot(
                axum::http::Request::builder()
                    .uri("/auth/me")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get(header::CACHE_CONTROL).unwrap(), "no-store");
        assert_eq!(body(response).await["email"], "seller@example.com");
    }

    /// Four different failures, one answer — that is the property the single
    /// `Unauthorized` variant exists for.
    #[tokio::test]
    async fn me_rejects_every_bad_token_the_same_way() {
        let app = app();
        sign_up(&app).await;

        let requests = [
            ("no header", None),
            ("no scheme", Some("Bearer".to_string())),
            ("no token", Some("Bearer ".to_string())),
            ("wrong scheme", Some("Basic abc123".to_string())),
            ("unknown token", Some("Bearer not-a-real-token".to_string())),
            ("whitespace token", Some("Bearer a b".to_string())),
        ];

        for (case, authorization) in requests {
            let mut builder = axum::http::Request::builder().uri("/auth/me");
            if let Some(value) = authorization {
                builder = builder.header(header::AUTHORIZATION, value);
            }
            let response = app.clone().oneshot(builder.body(Body::empty()).unwrap()).await.unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{case}");
            assert_eq!(
                response.headers().get(header::CACHE_CONTROL).unwrap(),
                "no-store",
                "{case}"
            );
            assert_eq!(
                raw(response).await,
                r#"{"message":"Unauthorized","error":"Unauthorized","statusCode":401}"#,
                "{case}"
            );
        }
    }

    /// Expiry is checked as part of the lookup, so a dead session is not a
    /// session: correctness never depended on a sweep. The sweep exists anyway,
    /// on login, because the table's cost did.
    #[tokio::test]
    async fn an_expired_session_is_rejected() {
        let token = "already-expired-token".to_string();
        let store = Arc::new(InMemoryStore::default());
        store
            .create_session(
                &hash_token(&token),
                "usr_whatever",
                chrono::Utc::now().naive_utc() - chrono::Duration::seconds(1),
            )
            .await
            .unwrap();

        let response = router(AppState::new(Config::default(), store, None, None))
            .oneshot(
                axum::http::Request::builder()
                    .uri("/auth/me")
                    .header(header::AUTHORIZATION, format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn logout_revokes_the_token_immediately_and_twice_is_still_a_204() {
        let app = app();
        let token = sign_up(&app).await;
        let logout = || {
            axum::http::Request::builder()
                .method(Method::POST)
                .uri("/auth/logout")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap()
        };
        let me = || {
            axum::http::Request::builder()
                .uri("/auth/me")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap()
        };

        let response = app.clone().oneshot(logout()).await.unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        // A bare 204: no content type, no ETag, nothing to misparse.
        assert!(!response.headers().contains_key(header::CONTENT_TYPE));
        assert!(!response.headers().contains_key(header::ETAG));

        assert_eq!(app.clone().oneshot(me()).await.unwrap().status(), StatusCode::UNAUTHORIZED);
        assert_eq!(app.oneshot(logout()).await.unwrap().status(), StatusCode::UNAUTHORIZED);
    }

    /// The stored row is keyed by the SHA-256 of the token, never by the token
    /// itself — that is the whole reason a database leak does not hand over live
    /// sessions.
    #[tokio::test]
    async fn only_the_hash_of_a_token_is_persisted() {
        let token = sign_up(&app()).await;
        let hash = hash_token(&token);
        assert_ne!(hash, token);
        assert!(!token.contains(&hash));
    }

    #[tokio::test]
    async fn login_issues_a_new_token_each_time() {
        let app = app();
        sign_up(&app).await;
        let login = json!({ "email": "seller@example.com", "password": "correct horse battery" });
        let first = body(
            app.clone()
                .oneshot(json_request(Method::POST, "/auth/login", login.clone()))
                .await
                .unwrap(),
        )
        .await["token"]
            .as_str()
            .expect("token")
            .to_string();
        let second =
            body(app.oneshot(json_request(Method::POST, "/auth/login", login)).await.unwrap())
                .await["token"]
                .as_str()
                .expect("token")
                .to_string();
        assert_ne!(first, second);
    }
}
