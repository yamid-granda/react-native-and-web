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
    let handle = match PrometheusBuilder::new().install_recorder() {
        Ok(handle) => handle,
        Err(error) => {
            eprintln!("metrics recorder not installed: {error}");
            return None;
        }
    };

    describe_api_metrics();
    // Registering the login counter at zero is what the old comment claimed
    // describing would do, and describing does not do it: the exporter keeps its
    // description map separate from its counter registry, so a described series
    // is still absent from a scrape until something emits it. Registering it is
    // one line at boot and it is the only series worth it — a brute-force
    // attempt is invisible until someone looks, and "no logins have failed" and
    // "this scrape cannot see logins" must not read the same on a dashboard.
    // The pair is registered rather than the bare name so the series carries the
    // `result` label the emission site uses, with no unlabelled twin. This is
    // why the per-IP login throttle exists; `auth_login_total` is charted on
    // `api-red.json`, and the choice not to alert on it is recorded in
    // `ARCHITECTURE.md` §7 alongside the other expected-client-behaviour rates.
    metrics::counter!("auth_login_total", "result" => "ok").increment(0);
    metrics::counter!("auth_login_total", "result" => "invalid").increment(0);

    Some(handle)
}

/// Documents every series `/metrics` can emit, so a scrape is self-describing.
///
/// Order matters and is not incidental. `describe_*` dispatches to whichever
/// recorder is installed *at the moment it runs*, and the exporter keeps its
/// description map on the recorder instance — handed to the no-op recorder, or
/// to a different instance, a description is discarded rather than queued. So
/// this must run after `install_recorder()` succeeds, which is why it is a
/// separate function called from the `Ok` arm rather than a block above the
/// `match`.
///
/// Descriptions are additive to a scrape: they add `# HELP` lines where there
/// were none and cannot change a sample value. The names here are checked
/// against `metrics_names::METRICS` by `metrics_names`'s tests, so a series
/// added or renamed on the Rust side cannot leave this list behind.
fn describe_api_metrics() {
    use metrics::Unit::{Bytes, Count, Seconds};

    // RED — every request, including shed and limited ones, because the metrics
    // middleware wraps the limiter.
    metrics::describe_counter!(
        "http_requests_total",
        Count,
        "Requests handled, by method, matched route and response status. \
         Unmatched paths are measured as route=\"unmatched\"."
    );
    metrics::describe_histogram!(
        "http_requests_duration_seconds",
        Seconds,
        "Handler duration in seconds, by method, matched route and response status."
    );

    // Load protection. `scope` separates the bounds, because "shed" and
    // "limited" are different problems with different fixes.
    metrics::describe_counter!(
        "http_load_shed_total",
        Count,
        "Requests refused with 503 before the handler ran, by scope: \
         global-concurrency, ip-concurrency, or ip-untracked when the per-IP \
         registry is at its cap."
    );
    metrics::describe_counter!(
        "http_rate_limited_total",
        Count,
        "Requests refused with 429 by the rps window, by scope: ip, global, \
         or auth for the credential-endpoint throttle. Expected client \
         behaviour, so it is charted rather than alerted on."
    );
    metrics::describe_counter!(
        "rate_limit_errors_total",
        Count,
        "Rate-limit window operations that failed, by op: incr or expire. The \
         service fails open — the request is allowed and this is counted — so a \
         non-zero expire means window keys are leaking in Valkey."
    );

    // Cache tiers. `kind` is the cache namespace: list or detail.
    metrics::describe_counter!(
        "cache_l1_hits_total",
        Count,
        "In-process cache reads served from L1, by kind."
    );
    metrics::describe_counter!(
        "cache_l1_misses_total",
        Count,
        "In-process cache reads not served from L1, by kind."
    );
    metrics::describe_counter!(
        "cache_l2_hits_total",
        Count,
        "Cache reads served from the shared Valkey tier, by kind."
    );
    metrics::describe_counter!(
        "cache_l2_misses_total",
        Count,
        "Cache reads that reached Valkey and found nothing, by kind."
    );
    metrics::describe_counter!(
        "cache_l2_writes_total",
        Count,
        "Entries written to the shared Valkey tier, by kind."
    );
    metrics::describe_counter!(
        "cache_l2_errors_total",
        Count,
        "Valkey operations that failed, by op: get, set, del, get-generation or \
         incr-generation. Every one of these degrades to a cache miss rather than \
         to an error."
    );
    metrics::describe_counter!(
        "cache_list_generation_bumps_total",
        Count,
        "List namespace generations bumped, i.e. writes that retired every \
         cached list page."
    );
    metrics::describe_counter!(
        "cache_singleflight_leader_total",
        Count,
        "Cache fills that won their singleflight lock and ran the store call, \
         by kind."
    );
    metrics::describe_counter!(
        "cache_singleflight_follower_total",
        Count,
        "Cache fills that joined an in-flight singleflight and waited for the \
         leader instead of running a second store call, by kind."
    );
    metrics::describe_histogram!(
        "cache_singleflight_wait_seconds",
        Seconds,
        "Time a singleflight follower spent waiting on the leader's store call."
    );

    // Identity.
    metrics::describe_counter!(
        "auth_login_total",
        Count,
        "Password login attempts by outcome: result=ok|invalid."
    );
    metrics::describe_counter!(
        "session_cleanup_errors_total",
        Count,
        "Expired-session deletes that failed. Fail-open: the token being minted \
         is unaffected and the failure is warned."
    );

    // Process and pool, sampled every 5s.
    metrics::describe_histogram!(
        "sqlx_pool_acquire_seconds",
        Seconds,
        "Time spent waiting for a connection from the pool, by pool role."
    );
    metrics::describe_gauge!(
        "sqlx_pool_size",
        Count,
        "Connections the pool currently holds, idle included, by pool role. \
         Subtract sqlx_pool_idle for the number in use."
    );
    metrics::describe_gauge!(
        "sqlx_pool_idle",
        Count,
        "Connections the pool holds that are not in use, by pool role."
    );
    metrics::describe_gauge!(
        "process_resident_memory_bytes",
        Bytes,
        "Resident set size of the api-rs process."
    );
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
