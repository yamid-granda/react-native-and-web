use std::time::{Duration, Instant};

use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde::Serialize;

use crate::app::AppState;
use crate::error::json_response;

/// The `/health` contract: `{status, info, error, details}` with the `database`
/// indicator detail carrying `responseTime` (whole milliseconds, measured
/// around the ping) and, when down, a `message`. Key order is fixed because the
/// committed golden fixtures in `tests/fixtures/` byte-compare it.
#[derive(Serialize)]
struct HealthBody {
    status: &'static str,
    info: Summary,
    error: Summary,
    details: Summary,
}

#[derive(Serialize)]
struct Summary {
    #[serde(skip_serializing_if = "Option::is_none")]
    database: Option<Indicator>,
}

#[derive(Clone, Serialize)]
struct Indicator {
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(rename = "responseTime")]
    response_time: u64,
    status: &'static str,
}

fn up(response_time: u64) -> Indicator {
    Indicator { message: None, response_time, status: "up" }
}

fn down(message: String, response_time: u64) -> Indicator {
    Indicator { message: Some(message), response_time, status: "down" }
}

pub async fn health(State(state): State<AppState>, request: Request) -> Response {
    let (parts, _body) = request.into_parts();
    let timeout = Duration::from_millis(state.config.health_ping_timeout_ms);

    let started = Instant::now();
    let pinged = tokio::time::timeout(timeout, state.store.ping()).await;
    let response_time = (started.elapsed().as_secs_f64() * 1000.0).round() as u64;

    let (status, body) = match pinged {
        Ok(Ok(())) => {
            let indicator = up(response_time);
            (
                StatusCode::OK,
                HealthBody {
                    status: "ok",
                    info: Summary { database: Some(indicator.clone()) },
                    error: Summary { database: None },
                    details: Summary { database: Some(indicator) },
                },
            )
        }
        Ok(Err(error)) => {
            // The thrown error's `message` goes here; ours is the sqlx error
            // text — same shape, implementation-specific text.
            down_body(error.to_string(), response_time)
        }
        Err(_elapsed) => {
            down_body(format!("timeout of {}ms exceeded", timeout.as_millis()), response_time)
        }
    };

    let bytes = serde_json::to_vec(&body).expect("health body always serializes");
    json_response(status, bytes, &[], Some((&parts.method, &parts.headers)))
}

fn down_body(message: String, response_time: u64) -> (StatusCode, HealthBody) {
    let indicator = down(message, response_time);
    (
        StatusCode::SERVICE_UNAVAILABLE,
        HealthBody {
            status: "error",
            info: Summary { database: None },
            error: Summary { database: Some(indicator.clone()) },
            details: Summary { database: Some(indicator) },
        },
    )
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::body::Body;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use crate::app::router;
    use crate::config::Config;
    use crate::store::{InMemoryStore, StoreOp};

    use super::*;

    async fn get_health(config: Config, store: InMemoryStore) -> (StatusCode, serde_json::Value) {
        let state = AppState::new(config, Arc::new(store), None, None);
        let response = router(state)
            .oneshot(axum::http::Request::builder().uri("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[test]
    fn up_body_has_contract_key_order() {
        let body = HealthBody {
            status: "ok",
            info: Summary { database: Some(up(3)) },
            error: Summary { database: None },
            details: Summary { database: Some(up(3)) },
        };
        assert_eq!(
            serde_json::to_string(&body).unwrap(),
            r#"{"status":"ok","info":{"database":{"responseTime":3,"status":"up"}},"error":{},"details":{"database":{"responseTime":3,"status":"up"}}}"#
        );
    }

    #[test]
    fn down_body_has_contract_key_order() {
        let (status, body) = down_body("db went away".to_string(), 7);
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            serde_json::to_string(&body).unwrap(),
            r#"{"status":"error","info":{},"error":{"database":{"message":"db went away","responseTime":7,"status":"down"}},"details":{"database":{"message":"db went away","responseTime":7,"status":"down"}}}"#
        );
    }

    /// The arm a store error takes. It used to be reachable only from
    /// `tests/e2e_products.rs` against a database that had been taken away,
    /// because every router-level test ran against a store that could not fail.
    #[tokio::test]
    async fn down_when_the_store_errors() {
        let store = InMemoryStore::default();
        store.fail_always(StoreOp::Ping);

        let (status, body) = get_health(Config::default(), store).await;

        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["status"], "error");
        assert_eq!(body["error"]["database"]["status"], "down");
        assert_eq!(body["details"]["database"]["status"], "down");
        assert!(body["info"]["database"].is_null(), "a down check has no up answer");
        assert!(
            body["error"]["database"]["message"].as_str().is_some_and(|m| !m.is_empty()),
            "the error's own text is what a human reads"
        );
    }

    /// The arm a slow store takes. The store's future never resolves, so
    /// `tokio::time::timeout` is what ends it — which is the whole point. A
    /// sleep longer than the timeout would prove only that a sleep elapsed.
    #[tokio::test]
    async fn down_when_the_store_outlives_the_ping_timeout() {
        let store = InMemoryStore::default();
        store.hang_always(StoreOp::Ping);

        let (status, body) =
            get_health(Config { health_ping_timeout_ms: 25, ..Config::default() }, store).await;

        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(body["status"], "error");
        assert_eq!(body["error"]["database"]["status"], "down");
        assert_eq!(body["error"]["database"]["message"], "timeout of 25ms exceeded");
    }

    /// One-shot is one-shot: the next probe after a failed one is a normal
    /// up. A load balancer retries, so a store that kept failing after a single
    /// blip would take a healthy service out of rotation.
    #[tokio::test]
    async fn one_failed_probe_does_not_poison_the_next() {
        let store = InMemoryStore::default();
        store.fail_once(StoreOp::Ping);

        let (first_status, _) = get_health(Config::default(), store.clone()).await;
        let (second_status, body) = get_health(Config::default(), store).await;

        assert_eq!(first_status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(second_status, StatusCode::OK);
        assert_eq!(body["status"], "ok");
        assert_eq!(body["details"]["database"]["status"], "up");
        assert!(body["error"]["database"].is_null());
    }
}
