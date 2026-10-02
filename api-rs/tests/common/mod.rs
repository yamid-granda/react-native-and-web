// This module is compiled into both test binaries, and neither one uses the
// whole surface, so unused items here are expected rather than dead code.
#![allow(dead_code)]

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use api_rs::app::{router, AppState};
use api_rs::config::Config;
use api_rs::store::SqlProductStore;
use chrono::NaiveDateTime;
use redis::aio::ConnectionManager;
use serde::Deserialize;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use testcontainers::core::wait::LogWaitStrategy;
use testcontainers::core::{IntoContainerPort, WaitFor};
use testcontainers::runners::AsyncRunner;
use testcontainers::{ContainerAsync, GenericImage, ImageExt};
use tokio::task::JoinHandle;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureProduct {
    id: String,
    title: String,
    description: Option<String>,
    price: f64,
    currency: String,
    image_url: Option<String>,
    stock: i32,
    created_at: String,
}

pub struct TestStack {
    pub base_url: String,
    pub pool: PgPool,
    pub valkey: Option<ConnectionManager>,
    _postgres: ContainerAsync<GenericImage>,
    _valkey: Option<ContainerAsync<GenericImage>>,
    _server: JoinHandle<()>,
}

/// Point testcontainers at the Docker socket that actually exists.
///
/// testcontainers defaults to `/var/run/docker.sock`, which is what Docker
/// Desktop provides but *not* what Colima does — Colima listens on its own
/// socket under `~/.colima`. Relying on the caller's shell exporting
/// `DOCKER_HOST` only works in interactive shells, so IDEs, CI runners and
/// scripts fail with `SocketNotFoundError`. Resolving it here keeps
/// `pnpm test:e2e` working regardless of how it was invoked.
///
/// An explicit `DOCKER_HOST` always wins, so remote and rootless daemons are
/// unaffected.
fn use_colima_socket_if_present() {
    if std::env::var_os("DOCKER_HOST").is_some() {
        return;
    }
    let Some(colima) = colima_socket() else { return };
    std::env::set_var("DOCKER_HOST", format!("unix://{}", colima.display()));
}

fn docker_host() -> String {
    std::env::var("DOCKER_HOST").unwrap_or_else(|_| "unix:///var/run/docker.sock".to_string())
}

/// A missing daemon is the common failure and testcontainers' own message
/// ("SocketNotFoundError") does not say what to do about it.
fn start_hint(error: &testcontainers::core::error::TestcontainersError) -> String {
    let detail = error.to_string();
    // testcontainers phrases this as "Socket not found" or "SocketNotFound"
    // depending on the failure layer, so match on the word alone.
    if detail.to_lowercase().contains("socket") && detail.contains("not found") {
        format!(
            "{detail}\n  no Docker socket reachable — start a runtime with \
             `colima start` or Docker Desktop, then re-run"
        )
    } else {
        format!("start postgres test container: {detail}")
    }
}

fn colima_socket() -> Option<PathBuf> {
    // `DOCKER_CONFIG` and `COLIMA_HOME` are honoured so a relocated profile
    // still resolves.
    let home = std::env::var_os("COLIMA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".colima")))
        .unwrap_or_else(|| PathBuf::from(".colima"));

    // Prefer the running profile; `default` is Colima's own default name.
    let profile = std::env::var("COLIMA_PROFILE").unwrap_or_else(|_| "default".to_string());
    let running = home.join(&profile).join("docker.sock");
    if running.exists() {
        return Some(running);
    }
    // Fall back to any profile with a socket, since `colima start --profile
    // x` leaves the default one absent.
    std::fs::read_dir(&home)
        .ok()?
        .flatten()
        .map(|entry| entry.path().join("docker.sock"))
        .find(|socket| socket.exists())
}

/// A router wired to a store whose pool points at a closed port, so every
/// query fails. Covers the degraded `/health` body and the Nest-compatible 500
/// a product read returns while the database is down.
pub struct UnreachableDbStack {
    pub base_url: String,
    _server: JoinHandle<()>,
}

impl UnreachableDbStack {
    pub async fn start() -> Self {
        // Port 1 on loopback refuses immediately, so pool acquisition fails
        // well inside both the acquire and health-ping timeouts.
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(Duration::from_millis(200))
            .connect_lazy("postgresql://rnw:rnw@127.0.0.1:1/rnw_dev")
            .expect("lazy pool for the unreachable database");
        let config = Config {
            health_ping_timeout_ms: 500,
            rate_limit_global_rps: 0,
            rate_limit_per_ip_rps: 0,
            ..Config::default()
        };
        let state = AppState::new(config, Arc::new(SqlProductStore::new(pool)), None, None);
        let (base_url, server) = spawn_server(state).await;
        Self { base_url, _server: server }
    }
}

impl TestStack {
    pub async fn start(with_valkey: bool, config_patch: impl FnOnce(&mut Config)) -> Self {
        use_colima_socket_if_present();
        // `with_exposed_port` and `with_wait_for` are inherent to `GenericImage` and
        // must come before any `ImageExt` call, which turns the image into a
        // `ContainerRequest` that no longer exposes them.
        let postgres = GenericImage::new("postgres", "17-alpine")
            .with_exposed_port(5432.tcp())
            .with_wait_for(WaitFor::log(
                LogWaitStrategy::stdout_or_stderr("database system is ready to accept connections")
                    .with_times(2),
            ))
            .with_env_var("POSTGRES_DB", "rnw_test")
            .with_env_var("POSTGRES_USER", "rnw")
            .with_env_var("POSTGRES_PASSWORD", "rnw")
            .start()
            .await
            .unwrap_or_else(|error| {
                panic!("{} (docker host: {})", start_hint(&error), docker_host())
            });
        let host = postgres.get_host().await.expect("postgres host");
        let port = postgres.get_host_port_ipv4(5432).await.expect("postgres port");
        let database_url = format!("postgresql://rnw:rnw@{host}:{port}/rnw_test");
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(5))
            .connect(&database_url)
            .await
            .expect("connect to test postgres");

        apply_migrations(&pool).await;
        seed_fixtures(&pool).await;

        let (valkey, valkey_container) = if with_valkey {
            let container = GenericImage::new("valkey/valkey", "8")
                .with_exposed_port(6379.tcp())
                .with_wait_for(WaitFor::message_on_stdout("Ready to accept"))
                .start()
                .await
                .unwrap_or_else(|error| {
                    panic!("{} (docker host: {})", start_hint(&error), docker_host())
                });
            let host = container.get_host().await.expect("valkey host");
            let port = container.get_host_port_ipv4(6379).await.expect("valkey port");
            let client = redis::Client::open(format!("redis://{host}:{port}")).expect("valkey URL");
            let connection = ConnectionManager::new(client).await.expect("connect valkey");
            (Some(connection), Some(container))
        } else {
            (None, None)
        };

        let mut config = Config {
            database_url,
            valkey_url: None,
            db_acquire_timeout: Duration::from_millis(500),
            request_timeout: Duration::from_secs(5),
            l1_list_ttl: Duration::from_secs(60),
            l1_detail_ttl: Duration::from_secs(60),
            l2_ttl: Duration::from_secs(60),
            rate_limit_global_rps: 0,
            rate_limit_per_ip_rps: 0,
            ..Config::default()
        };
        config_patch(&mut config);
        let state = AppState::new(
            config,
            Arc::new(SqlProductStore::new(pool.clone())),
            valkey.clone(),
            None,
        );

        let (base_url, server) = spawn_server(state).await;

        Self {
            base_url,
            pool,
            valkey,
            _postgres: postgres,
            _valkey: valkey_container,
            _server: server,
        }
    }
}

/// Binds an ephemeral port and serves `state` on a background task, returning
/// the base URL plus the join handle that keeps the server alive.
async fn spawn_server(state: AppState) -> (String, JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind ephemeral port");
    let address: SocketAddr = listener.local_addr().expect("listener address");
    let server = tokio::spawn(async move {
        axum::serve(listener, router(state).into_make_service_with_connect_info::<SocketAddr>())
            .await
            .expect("test server");
    });
    (format!("http://{address}"), server)
}

async fn apply_migrations(pool: &PgPool) {
    sqlx::raw_sql(include_str!("../../../api/prisma/migrations/20260926133034/migration.sql"))
        .execute(pool)
        .await
        .expect("apply initial Prisma migration");
    sqlx::raw_sql(include_str!("../../../api/prisma/migrations/20260929101635/migration.sql"))
        .execute(pool)
        .await
        .expect("apply stock Prisma migration");
}

async fn seed_fixtures(pool: &PgPool) {
    let fixtures: Vec<FixtureProduct> =
        serde_json::from_str(include_str!("../fixtures/products.json"))
            .expect("valid product fixture JSON");
    for product in fixtures {
        let created_at =
            NaiveDateTime::parse_from_str(&product.created_at, "%Y-%m-%d %H:%M:%S%.3f")
                .expect("fixture timestamp");
        sqlx::query(
            r#"INSERT INTO "Product" ("id", "title", "description", "price", "currency", "imageUrl", "stock", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
        )
        .bind(product.id)
        .bind(product.title)
        .bind(product.description)
        .bind(product.price)
        .bind(product.currency)
        .bind(product.image_url)
        .bind(product.stock)
        .bind(created_at)
        .execute(pool)
        .await
        .expect("insert fixture product");
    }
}
