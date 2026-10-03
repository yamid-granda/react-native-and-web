use std::net::SocketAddr;
use std::sync::Arc;

use api_rs::app::{router, AppState};
use api_rs::config::Config;
use api_rs::store::SqlProductStore;
use api_rs::telemetry;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Optional api-rs/.env; the compose stack's env works without it.
    let _ = dotenvy::dotenv();
    let config = Config::from_env()?;

    telemetry::init_tracing().await;
    let metrics = telemetry::init_metrics();

    let pool = api_rs::store::connect_primary_pool(
        &config.database_url,
        config.db_max_connections,
        config.db_acquire_timeout,
    )
    .await?;
    telemetry::spawn_pool_sampler(pool.clone(), "primary");
    telemetry::spawn_rss_sampler();

    // A read replica is an accelerator, not a dependency: unreachable or
    // misconfigured means reads stay on the primary, exactly as before.
    let read_pool = match config.database_read_url.as_deref() {
        Some(url) => {
            let pool = api_rs::store::connect_read_replica(
                url,
                config.db_read_max_connections,
                config.db_acquire_timeout,
            )
            .await;
            if let Some(pool) = &pool {
                telemetry::spawn_pool_sampler(pool.clone(), "read");
            }
            pool
        }
        None => None,
    };

    let valkey = match config.valkey_url.as_deref() {
        Some(url) => connect_valkey(url).await,
        None => None,
    };

    let store = match read_pool {
        Some(read) => SqlProductStore::with_read_replica(pool, read),
        None => SqlProductStore::new(pool),
    };
    let state = AppState::new(config.clone(), Arc::new(store), valkey, metrics);
    // The list-key generation counter (§12) is held in process and refreshed
    // here, on the L2 TTL: that is how long a retired list entry can still be
    // addressable, so this interval is what bounds cross-instance staleness
    // after a write. Started after `AppState::new` because that constructor is
    // synchronous and is also used by tests and benches that want no task.
    state.cache.spawn_generation_refresher(state.config.l2_ttl);
    let app = router(state);

    let address = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(port = config.port, "api-rs listening");

    // SIGTERM/Ctrl-C drain in-flight requests before exit so deploys and
    // scale-downs don't drop traffic.
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    tracing::info!("shutdown complete");
    Ok(())
}

/// Valkey is an accelerator, never a dependency: if it can't be reached at
/// startup the L2 cache and shared rate limiting stay off (fail-open) and the
/// service runs on L1 + Postgres alone.
async fn connect_valkey(url: &str) -> Option<redis::aio::ConnectionManager> {
    let client = match redis::Client::open(url) {
        Ok(client) => client,
        Err(error) => {
            tracing::warn!(error = %error, "invalid VALKEY_URL; L2 cache and rate limiting disabled");
            return None;
        }
    };
    match redis::aio::ConnectionManager::new(client).await {
        Ok(conn) => Some(conn),
        Err(error) => {
            tracing::warn!(error = %error, "Valkey unreachable; L2 cache and rate limiting disabled");
            None
        }
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c().await.expect("failed to install Ctrl+C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received, draining in-flight requests");
}
