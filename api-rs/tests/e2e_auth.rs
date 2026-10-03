//! `/auth/*` against a real server, a real Postgres and a real Valkey.
//!
//! The unit suite covers the same handlers in-process; what this file is for is
//! the parts that only exist end to end — the unique constraint doing the
//! concurrency work, and a token that stops working the moment its row is gone.

mod common;

use reqwest::StatusCode;
use serde_json::{json, Value};

const PASSWORD: &str = "correct horse battery";

/// A fresh address per test: they share one database, and a duplicate
/// registration is a 409 by design.
/// Lowercased: the store normalises addresses on insert, so the value a test
/// reads back is not the value it sent.
fn unique_email(prefix: &str) -> String {
    format!("{prefix}-{}@rnw.test", common::unique_suffix()).to_lowercase()
}

async fn register(client: &reqwest::Client, base: &str, email: &str) -> reqwest::Response {
    client
        .post(format!("{base}/auth/register"))
        .json(&json!({ "email": email, "password": PASSWORD, "storeName": "Riverbend Vintage" }))
        .send()
        .await
        .unwrap()
}

#[tokio::test]
async fn register_login_me_logout_is_one_working_session() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let client = reqwest::Client::new();
    let email = unique_email("flow");

    let response = register(&client, &stack.base_url, &email).await;
    assert_eq!(response.status(), StatusCode::CREATED);
    let registered: Value = response.json().await.unwrap();
    let token = registered["token"].as_str().expect("token").to_string();
    let user_id = registered["user"]["id"].as_str().expect("id").to_string();

    // A second registration of the same address loses to the unique constraint.
    assert_eq!(register(&client, &stack.base_url, &email).await.status(), StatusCode::CONFLICT);

    // Logging in again yields a different, equally valid token.
    let login: Value = client
        .post(format!("{}/auth/login", stack.base_url))
        .json(&json!({ "email": email.to_uppercase(), "password": PASSWORD }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(login["user"]["id"], user_id.as_str());
    let second_token = login["token"].as_str().expect("token").to_string();
    assert_ne!(second_token, token);

    let bearer = |value: &str| format!("Bearer {value}");

    for token in [&token, &second_token] {
        let me: Value = client
            .get(format!("{}/auth/me", stack.base_url))
            .header("authorization", bearer(token))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(me["email"], email.as_str());
        assert_eq!(me["storeName"], "Riverbend Vintage");
    }

    // Logging out one of them leaves the other alone: sessions are rows, and
    // revoking one is not revoking the account.
    assert_eq!(
        client
            .post(format!("{}/auth/logout", stack.base_url))
            .header("authorization", bearer(&token))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        client
            .get(format!("{}/auth/me", stack.base_url))
            .header("authorization", bearer(&token))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        client
            .get(format!("{}/auth/me", stack.base_url))
            .header("authorization", bearer(&second_token))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
}

/// The raw token must never be in the database — only its SHA-256 is.
#[tokio::test]
async fn the_session_table_holds_the_hash_and_not_the_token() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let client = reqwest::Client::new();
    let email = unique_email("hash");

    let registered: Value = register(&client, &stack.base_url, &email).await.json().await.unwrap();
    let token = registered["token"].as_str().expect("token").to_string();

    let stored: String =
        sqlx::query_scalar(r#"SELECT "tokenHash" FROM "Session" WHERE "userId" = $1"#)
            .bind(registered["user"]["id"].as_str().unwrap())
            .fetch_one(&stack.pool)
            .await
            .unwrap();
    assert_ne!(stored, token);
    assert_eq!(stored, common::hash_token(&token));

    let count: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "Session" WHERE "tokenHash" = $1"#)
        .bind(&token)
        .fetch_one(&stack.pool)
        .await
        .unwrap();
    assert_eq!(count, 0, "the raw token is nowhere in the database");
}

/// The one guarantee the `UNIQUE` index exists for: two simultaneous
/// registrations of one address cannot both succeed.
#[tokio::test]
async fn concurrent_registrations_of_one_address_produce_exactly_one_seller() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let client = reqwest::Client::new();
    let email = unique_email("race");

    let mut tasks = Vec::new();
    for _ in 0..4 {
        let client = client.clone();
        let base = stack.base_url.clone();
        let email = email.clone();
        tasks.push(tokio::spawn(async move {
            register(&client, &base, &email).await.status().as_u16()
        }));
    }

    let mut statuses: Vec<u16> = Vec::new();
    for task in tasks {
        statuses.push(task.await.unwrap());
    }
    statuses.sort_unstable();
    assert_eq!(statuses, vec![201, 409, 409, 409], "{statuses:?}");

    let sellers: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM "User" WHERE "email" = $1"#)
        .bind(&email)
        .fetch_one(&stack.pool)
        .await
        .unwrap();
    assert_eq!(sellers, 1);
}

/// `find_valid` checks the expiry as part of the lookup, so a row nobody swept
/// still cannot authenticate.
#[tokio::test]
async fn an_expired_session_row_is_rejected() {
    let stack = common::TestStack::start(true, |_| {}).await;
    let client = reqwest::Client::new();
    let email = unique_email("expiry");

    let registered: Value = register(&client, &stack.base_url, &email).await.json().await.unwrap();
    let token = registered["token"].as_str().expect("token").to_string();

    sqlx::query(r#"UPDATE "Session" SET "expiresAt" = $1"#)
        .bind(chrono::Utc::now().naive_utc() - chrono::Duration::days(1))
        .execute(&stack.pool)
        .await
        .unwrap();

    let response = client
        .get(format!("{}/auth/me", stack.base_url))
        .header("authorization", format!("Bearer {token}"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

/// Login is the one unauthenticated route that costs a hash, so it carries its
/// own per-IP window on top of the global limiter.
#[tokio::test]
async fn the_login_throttle_returns_429_before_the_global_one_does() {
    let stack = common::TestStack::start(true, |config| {
        // Global and per-IP request limits off, so the only window in play is the
        // credential one this feature added.
        config.rate_limit_global_rps = 0;
        config.rate_limit_per_ip_rps = 0;
        config.auth_login_attempts_per_min = 3;
    })
    .await;
    let client = reqwest::Client::new();

    let mut statuses = Vec::new();
    for _ in 0..6 {
        statuses.push(
            client
                .post(format!("{}/auth/login", stack.base_url))
                .json(&json!({ "email": "nobody@rnw.test", "password": "guess guess guess" }))
                .send()
                .await
                .unwrap()
                .status(),
        );
    }
    assert_eq!(statuses[0], StatusCode::UNAUTHORIZED);
    assert_eq!(
        statuses.iter().filter(|status| **status == StatusCode::UNAUTHORIZED).count(),
        3,
        "{statuses:?}"
    );
    assert!(statuses.contains(&StatusCode::TOO_MANY_REQUESTS), "{statuses:?}");

    // The marketplace is untouched by the credential window.
    assert_eq!(
        client.get(format!("{}/products", stack.base_url)).send().await.unwrap().status(),
        StatusCode::OK
    );
}

/// Fail-open, like every Valkey consumer here: no shared tier means no login
/// throttle, never a dead service.
#[tokio::test]
async fn the_login_throttle_is_absent_without_valkey() {
    let stack = common::TestStack::start(false, |config| {
        config.auth_login_attempts_per_min = 1;
    })
    .await;
    let client = reqwest::Client::new();
    for _ in 0..4 {
        assert_eq!(
            client
                .post(format!("{}/auth/login", stack.base_url))
                .json(&json!({ "email": "nobody@rnw.test", "password": "guess guess guess" }))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }
}
