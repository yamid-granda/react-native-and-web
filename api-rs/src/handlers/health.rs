use std::time::{Duration, Instant};

use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde::Serialize;

use crate::app::AppState;
use crate::error::json_response;

/// Terminus body: `{status, info, error, details}` with the `database`
/// indicator detail carrying `responseTime` (whole milliseconds, measured
/// around the ping) and, when down, a `message`. Key order matches terminus's
/// `HealthIndicatorSession.compose` output.
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
            // terminus puts the thrown error's `message` here; ours is the
            // sqlx error text — same shape, implementation-specific text.
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
    use super::*;

    #[test]
    fn up_body_matches_terminus() {
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
    fn down_body_matches_terminus() {
        let (status, body) = down_body("db went away".to_string(), 7);
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            serde_json::to_string(&body).unwrap(),
            r#"{"status":"error","info":{},"error":{"database":{"message":"db went away","responseTime":7,"status":"down"}},"details":{"database":{"message":"db went away","responseTime":7,"status":"down"}}}"#
        );
    }
}
