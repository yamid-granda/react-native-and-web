use std::sync::Arc;
use std::time::Instant;

use axum::extract::{MatchedPath, Request, State};
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, get, patch, post};
use axum::Router;
use metrics_exporter_prometheus::PrometheusHandle;
use redis::aio::ConnectionManager;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{AllowHeaders, AllowMethods, CorsLayer};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::TraceLayer;

use crate::cache::{CacheTier, L1Cache, L2Cache};
use crate::config::Config;
use crate::error::{json_response, ErrorBody};
use crate::handlers::{auth, health, my_store, products, stores};
use crate::middleware::rate_limit::{self, RateLimiter};
use crate::store::MarketplaceStore;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    /// Products, users and sessions behind one trait object. One `Arc`, one
    /// pool, and each store method decides for itself whether a replica is safe
    /// to answer it.
    pub store: Arc<dyn MarketplaceStore>,
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
        store: Arc<dyn MarketplaceStore>,
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
        // `/auth/register` and `/auth/login` are declared first and on purpose:
        // `route_layer` applies to the routes that already exist when it is
        // called, and to nothing added afterwards. Putting the credential
        // throttle here is therefore how it is scoped to exactly these two —
        // the two routes an unauthenticated caller can hammer, each costing an
        // argon2 hash.
        .route("/auth/register", post(auth::register).fallback(any(fallback)))
        .route("/auth/login", post(auth::login).fallback(any(fallback)))
        .route_layer(middleware::from_fn_with_state(state.clone(), rate_limit::enforce_auth))
        .route("/health", get(health::health))
        // Method-level fallbacks pin the documented 404 contract: a POST to a
        // GET-only route is `Cannot POST /products`, not axum's default 405.
        .route("/products", get(products::list).fallback(any(fallback)))
        // Ahead of `/products/{id}` for readability, not correctness: axum
        // matches the literal segment first either way, so `by-ids` can never be
        // read as a product whose id is "by-ids".
        .route("/products/by-ids", get(products::by_ids).fallback(any(fallback)))
        .route("/products/{id}", get(products::detail).fallback(any(fallback)))
        .route("/stores/{id}", get(stores::detail).fallback(any(fallback)))
        .route("/stores/{id}/products", get(stores::products).fallback(any(fallback)))
        // Outside the credential throttle, because a live session is proof the
        // caller was not guessing.
        .route("/auth/logout", post(auth::logout).fallback(any(fallback)))
        .route("/auth/me", get(auth::me).fallback(any(fallback)))
        // Deliberately not `POST /products`: a mutation on the public namespace
        // reads as "anyone may create a product", which is the exact hole this
        // service is meant to close. The path says what authentication is
        // required.
        .route(
            "/my-store/products",
            get(my_store::list).post(my_store::create).fallback(any(fallback)),
        )
        .route(
            "/my-store/products/{id}",
            patch(my_store::update).delete(my_store::delete).fallback(any(fallback)),
        )
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

/// Single-origin CORS for the web client, reflecting the preflight's requested
/// methods and headers so the browser can send the real request.
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

/// Unmatched-route and wrong-method handler: `Cannot ${method} ${url}`, with
/// `url` including the query string, in the same JSON error shape as every
/// other 404.
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
    let body = ErrorBody {
        message: format!("Cannot {} {}", parts.method, url),
        error: Some("Not Found"),
        status_code: 404,
    };
    json_response(StatusCode::NOT_FOUND, body.to_vec(), &[], Some((&parts.method, &parts.headers)))
}

/// axum's `get` already routes HEAD to GET handlers; this documents that
/// OPTIONS is answered by the CORS layer too.
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

    /// Cheap argon2 for the whole handler suite: `cargo test --lib` registers,
    /// logs in and verifies dozens of times, and at production parameters that is
    /// the slowest thing in the build by an order of magnitude.
    fn cheap_hash_state() -> AppState {
        crate::auth::password::use_cheap_params_for_tests();
        test_state()
    }

    async fn body_string(response: Response) -> String {
        let bytes: Bytes = response.into_body().collect().await.unwrap().to_bytes();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    #[tokio::test]
    async fn unmatched_route_returns_cannot_method_url_404() {
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
    async fn wrong_method_returns_404_not_405() {
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

    /// The 404-not-405 contract has to hold on the new routes too, or a wrong
    /// method there would be the one place axum's default 405 leaks through.
    #[tokio::test]
    async fn wrong_method_on_a_seller_route_is_404_not_405() {
        // PUT is declared by no method router here, so it reaches the fallback.
        let response = router(cheap_hash_state())
            .oneshot(
                axum::http::Request::builder()
                    .method(Method::PUT)
                    .uri("/my-store/products")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            body_string(response).await,
            r#"{"message":"Cannot PUT /my-store/products","error":"Not Found","statusCode":404}"#
        );

        // `/my-store/products/{id}` declares PATCH and DELETE only, so a GET on
        // it is a wrong method rather than a missing resource.
        let response = router(cheap_hash_state())
            .oneshot(
                axum::http::Request::builder()
                    .uri("/my-store/products/prod-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            body_string(response).await,
            r#"{"message":"Cannot GET /my-store/products/prod-1","error":"Not Found","statusCode":404}"#
        );

        // `GET /my-store/products` *is* declared, so it is answered — with a 401,
        // because no token came with it. It must not fall through to a 404.
        let response = router(cheap_hash_state())
            .oneshot(
                axum::http::Request::builder()
                    .uri("/my-store/products")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn an_unauthenticated_seller_route_is_401_with_no_store() {
        let response = router(cheap_hash_state())
            .oneshot(axum::http::Request::builder().uri("/auth/me").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(response.headers().get(header::CACHE_CONTROL).unwrap(), "no-store");
        assert_eq!(
            body_string(response).await,
            r#"{"message":"Unauthorized","error":"Unauthorized","statusCode":401}"#
        );
    }

    /// `/stores/{id}` is public: a storefront is a catalogue page, and the
    /// marketplace itself never required a token.
    #[tokio::test]
    async fn the_public_store_routes_need_no_token() {
        let response = router(test_state())
            .oneshot(
                axum::http::Request::builder()
                    .uri("/stores/usr-nobody/products")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            body_string(response).await,
            r#"{"message":"Store usr-nobody not found","error":"Not Found","statusCode":404}"#
        );
    }

    #[tokio::test]
    async fn cors_allows_configured_origin() {
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
