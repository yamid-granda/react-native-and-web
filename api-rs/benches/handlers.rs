use std::sync::Arc;
use std::time::Duration;

use api_rs::app::{router, AppState};
use api_rs::cache::CacheTier;
use api_rs::config::Config;
use api_rs::store::{InMemoryStore, Product};
use axum::body::Body;
use chrono::NaiveDateTime;
use criterion::{criterion_group, criterion_main, Criterion};
use tower::ServiceExt;

fn products(count: usize) -> Vec<Product> {
    let created_at =
        NaiveDateTime::parse_from_str("2026-01-01 00:00:00.000", "%Y-%m-%d %H:%M:%S%.3f").unwrap();
    (0..count)
        .map(|index| Product {
            id: format!("prod-{index:05}"),
            title: format!("Product {index}"),
            description: Some("Bench product description".to_string()),
            price: index as f64 + 0.99,
            currency: "USD".to_string(),
            image_url: None,
            stock: 100,
            created_at,
            owner_id: None,
            store_name: None,
        })
        .collect()
}

fn request(path: &'static str) -> axum::http::Request<Body> {
    axum::http::Request::builder().uri(path).body(Body::empty()).unwrap()
}

fn bench_handlers(criterion: &mut Criterion) {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let config = Config { rate_limit_per_ip_rps: 0, rate_limit_global_rps: 0, ..Config::default() };
    let store = Arc::new(InMemoryStore::new(products(50_000)));
    let app_uncached = router(AppState {
        config: Arc::new(config.clone()),
        store: store.clone(),
        cache: CacheTier::disabled(),
        limiter: api_rs::middleware::rate_limit::RateLimiter::new(&config, None),
        metrics: None,
    });
    let mut cached_state = AppState {
        config: Arc::new(config.clone()),
        store,
        cache: CacheTier::new(
            api_rs::cache::L1Cache::new(Duration::from_secs(60), Duration::from_secs(60)),
            None,
        ),
        limiter: api_rs::middleware::rate_limit::RateLimiter::new(&config, None),
        metrics: None,
    };
    let app_cached = router(cached_state.clone());
    // Pre-warm the page cache before timing the L1-hit path.
    runtime.block_on(async {
        app_cached.clone().oneshot(request("/products?page=1")).await.unwrap();
        app_cached.clone().oneshot(request("/products/prod-00000")).await.unwrap();
    });

    let mut group = criterion.benchmark_group("handlers");
    group.bench_function("list-page-cache-miss-50k", |bench| {
        bench.to_async(&runtime).iter(|| async {
            let response = app_uncached.clone().oneshot(request("/products?page=2")).await.unwrap();
            std::hint::black_box(response.status());
        });
    });
    group.bench_function("list-page-cache-hit", |bench| {
        bench.to_async(&runtime).iter(|| async {
            let response = app_cached.clone().oneshot(request("/products?page=1")).await.unwrap();
            std::hint::black_box(response.status());
        });
    });
    group.bench_function("detail-cache-hit", |bench| {
        bench.to_async(&runtime).iter(|| async {
            let response =
                app_cached.clone().oneshot(request("/products/prod-00000")).await.unwrap();
            std::hint::black_box(response.status());
        });
    });
    group.finish();
    cached_state.cache = CacheTier::disabled();
    std::hint::black_box(cached_state);
}

criterion_group! {
    name = benches;
    config = Criterion::default();
    targets = bench_handlers
}
criterion_main!(benches);
