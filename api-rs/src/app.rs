use std::sync::Arc;
use std::time::Instant;

use axum::extract::{MatchedPath, Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get};
use axum::Router;
use metrics_exporter_prometheus::PrometheusHandle;
use redis::aio::ConnectionManager;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowHeaders, AllowMethods, CorsLayer};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

use crate::cache::{CacheTier, L1Cache, L2Cache};
use crate::config::Config;
use crate::error::{json_response, NestErrorBody};
use crate::handlers::{health, products};
use crate::middleware::rate_limit::{self, RateLimiter};
use crate::store::ProductStore;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub store: Arc<dyn ProductStore>,
    pub cache: CacheTier,
    pub limiter: RateLimiter,
    /// `None` in tests where the global Prometheus recorder isn't installed.
    pub metrics: Option<PrometheusHandle>,
}

impl AppState {
    /// `valkey` feeds both cache tiers and the shared rate-limit counters;
    /// `None` disables them (fail-open), never the service itself.
    pub fn new(
        config: Config,
        store: Arc<dyn ProductStore>,
        valkey: Option<ConnectionManager>,
        metrics: Option<PrometheusHandle>,
    ) -> Self {
        let cache = CacheTier::new(
            L1Cache::new(config.l1_list_ttl, config.l1_detail_ttl),
            valkey.clone().map(|conn| L2Cache::new(conn, config.l2_ttl)),
        );
        let limiter = RateLimiter::new(&config, valkey);
        Self { config: Arc::new(config), store, cache, limiter, metrics }
    }
}

pub fn router(state: AppState) -> Router {
    let timeout = state.config.request_timeout;

    Router::new()
        .route("/health", get(health::health))
        // Method-level fallbacks keep Nest's parity: a POST to a GET-only
        // route is `Cannot POST /products` (404), not axum's default 405.
        .route("/products", get(products::list).fallback(any(fallback)))
        .route("/products/{id}", get(products::detail).fallback(any(fallback)))
        .route("/metrics", get(metrics_handler))
        // Order: metrics wraps rate limiting so shed/limited responses are
        // counted in RED too. route_layer keeps MatchedPath available.
        .route_layer(middleware::from_fn_with_state(state.clone(), rate_limit::enforce))
        .route_layer(middleware::from_fn(http_metrics))
        .fallback(fallback)
        .layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, timeout))
        .layer(cors_layer(&state.config))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// Mirrors `app.enableCors({ origin: "http://localhost:3000" })` in
/// `api/src/main.ts` (the `cors` package defaults to reflecting the
/// preflight's requested method/headers).
fn cors_layer(config: &Config) -> CorsLayer {
    let origin = config
        .cors_origin
        .parse::<HeaderValue>()
        .expect("CORS_ORIGIN must be a valid header value");
    CorsLayer::new()
        .allow_origin(origin)
        .allow_methods(AllowMethods::mirror_request())
        .allow_headers(AllowHeaders::mirror_request())
}

async fn http_metrics(request: Request, next: Next) -> Response {
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(|matched| matched.as_str().to_owned())
        .unwrap_or_else(|| "unmatched".to_owned());
    let method = request.method().to_string();
    let started = Instant::now();

    let response = next.run(request).await;

    let elapsed = started.elapsed().as_secs_f64();
    let status = response.status().as_u16().to_string();
    metrics::counter!(
        "http_requests_total",
        "method" => method.clone(),
        "route" => route.clone(),
        "status" => status.clone(),
    )
    .increment(1);
    metrics::histogram!(
        "http_requests_duration_seconds",
        "method" => method,
        "route" => route,
        "status" => status,
    )
    .record(elapsed);
    response
}

async fn metrics_handler(State(state): State<AppState>) -> Response {
    match &state.metrics {
        Some(handle) => {
            ([(header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")], handle.render())
                .into_response()
        }
        None => {
            (StatusCode::SERVICE_UNAVAILABLE, "metrics recorder not installed\n").into_response()
        }
    }
}

/// Nest's `routes-resolver` not-found handler: `Cannot ${method} ${url}`,
/// with `url` including the query string, and Express's JSON error shape.
pub async fn fallback(request: Request) -> Response {
    let (parts, _body) = request.into_parts();
    metrics::counter!(
        "http_requests_total",
        "method" => parts.method.to_string(),
        "route" => "unmatched",
        "status" => "404",
    )
    .increment(1);

    let url = parts.uri.path_and_query().map_or(parts.uri.path(), |pq| pq.as_str());
    let body = NestErrorBody {
        message: format!("Cannot {} {}", parts.method, url),
        error: Some("Not Found"),
        status_code: 404,
    };
    json_response(StatusCode::NOT_FOUND, body.to_vec(), &[], Some((&parts.method, &parts.headers)))
}

/// Method check kept explicit for parity with Express, which auto-routes HEAD
/// to GET handlers; axum's `get` does the same, and this documents OPTIONS.
#[allow(dead_code)]
fn supported_methods() -> [Method; 3] {
    [Method::GET, Method::HEAD, Method::OPTIONS]
}

#[cfg(test)]
mod tests {
    use axum::body::{Body, Bytes};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use super::*;
    use crate::store::InMemoryStore;

    pub(crate) fn test_state() -> AppState {
        AppState::new(Config::default(), Arc::new(InMemoryStore::default()), None, None)
    }

    async fn body_string(response: Response) -> String {
        let bytes: Bytes = response.into_body().collect().await.unwrap().to_bytes();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    #[tokio::test]
    async fn unmatched_route_matches_nest_404() {
        let response = router(test_state())
            .oneshot(axum::http::Request::builder().uri("/nope?x=1").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            body_string(response).await,
            r#"{"message":"Cannot GET /nope?x=1","error":"Not Found","statusCode":404}"#
        );
    }

    #[tokio::test]
    async fn wrong_method_matches_nest_404_not_405() {
        let response = router(test_state())
            .oneshot(
                axum::http::Request::builder()
                    .method(Method::POST)
                    .uri("/products")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            body_string(response).await,
            r#"{"message":"Cannot POST /products","error":"Not Found","statusCode":404}"#
        );
    }

    #[tokio::test]
    async fn empty_catalog_page_matches_service_envelope() {
        let response = router(test_state())
            .oneshot(axum::http::Request::builder().uri("/products").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/json; charset=utf-8"
        );
        assert_eq!(
            body_string(response).await,
            r#"{"items":[],"page":1,"limit":20,"total":0,"hasNextPage":false}"#
        );
    }

    #[tokio::test]
    async fn cors_mirrors_nest_config() {
        let response = router(test_state())
            .oneshot(
                axum::http::Request::builder()
                    .uri("/products")
                    .header("origin", "http://localhost:3000")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.headers().get("access-control-allow-origin").unwrap(),
            "http://localhost:3000"
        );
    }

    #[tokio::test]
    async fn metrics_endpoint_unavailable_without_recorder() {
        let response = router(test_state())
            .oneshot(axum::http::Request::builder().uri("/metrics").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    }
}
