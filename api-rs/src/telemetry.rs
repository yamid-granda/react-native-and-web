use std::time::Duration;

use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use sqlx::PgPool;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// JSON logs + env-driven filtering (`RUST_LOG`, default `info,sqlx=warn`).
/// With the `otlp` feature, traces additionally export over OTLP/gRPC to
/// `OTEL_EXPORTER_OTLP_ENDPOINT` (default `http://localhost:4317`).
pub async fn init_tracing() {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn"));
    let registry =
        tracing_subscriber::registry().with(filter).with(tracing_subscriber::fmt::layer().json());

    #[cfg(feature = "otlp")]
    {
        if let Some(layer) = otlp_layer().await {
            registry.with(layer).init();
            return;
        }
    }

    registry.init();
}

#[cfg(feature = "otlp")]
async fn otlp_layer<S>() -> Option<impl tracing_subscriber::Layer<S> + Send + Sync + 'static>
where
    S: tracing::Subscriber + Send + Sync + 'static,
{
    use opentelemetry::trace::TracerProvider as _;

    let endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .unwrap_or_else(|_| "http://localhost:4317".to_string());
    let exporter = match opentelemetry_otlp::SpanExporter::builder()
        .with_tonic()
        .with_endpoint(endpoint)
        .build()
        .await
    {
        Ok(exporter) => exporter,
        Err(error) => {
            eprintln!("OTLP exporter init failed, continuing without trace export: {error}");
            return None;
        }
    };
    let sample_ratio: f64 = std::env::var("OTEL_TRACES_SAMPLE_RATIO")
        .ok()
        .and_then(|raw| raw.parse().ok())
        .unwrap_or(0.1);
    let provider = opentelemetry_sdk::trace::SdkTracerProvider::builder()
        .with_batch_exporter(exporter)
        .with_sampler(opentelemetry_sdk::trace::Sampler::ParentBased(Box::new(
            opentelemetry_sdk::trace::Sampler::TraceIdRatioBased(sample_ratio),
        )))
        .build();
    // The tracer keeps the provider (and its batch exporter task) alive.
    let tracer = provider.tracer("api-rs");
    Some(tracing_opentelemetry::layer().with_tracer(tracer))
}

/// Installs the global metrics recorder and returns its render handle for
/// `/metrics`. `None` (with a warning) if a recorder is already installed.
pub fn init_metrics() -> Option<PrometheusHandle> {
    // Described up front so the series exists — at zero — before the first login
    // ever happens. A brute-force attempt is invisible until someone looks, and
    // "the counter is missing" and "nobody has tried to log in" must not look the
    // same on a dashboard. This is the reason the per-IP login throttle exists.
    metrics::describe_counter!(
        "auth_login_total",
        metrics::Unit::Count,
        "Password login attempts by outcome: result=ok|invalid"
    );
    match PrometheusBuilder::new().install_recorder() {
        Ok(handle) => Some(handle),
        Err(error) => {
            eprintln!("metrics recorder not installed: {error}");
            None
        }
    }
}

pub fn spawn_rss_sampler() {
    tokio::spawn(async {
        let mut ticker = tokio::time::interval(Duration::from_secs(5));
        loop {
            ticker.tick().await;
            if let Some(stats) = memory_stats::memory_stats() {
                metrics::gauge!("process_resident_memory_bytes").set(stats.physical_mem as f64);
            }
        }
    });
}

/// `role` labels the pool the gauge describes, so the primary and a read
/// replica are told apart on the dashboard.
pub fn spawn_pool_sampler(pool: PgPool, role: &'static str) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(5));
        loop {
            ticker.tick().await;
            metrics::gauge!("sqlx_pool_size", "pool" => role).set(pool.size() as f64);
            metrics::gauge!("sqlx_pool_idle", "pool" => role).set(pool.num_idle() as f64);
        }
    });
}
