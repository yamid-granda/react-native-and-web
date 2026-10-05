// This module is compiled into both test binaries, and neither one uses the
// whole surface, so unused items here are expected rather than dead code.
#![allow(dead_code)]

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use api_rs::app::{router, AppState};
use api_rs::config::Config;
use api_rs::migrations;
use api_rs::store::{connect_read_replica, MarketplaceStore, Product, SqlProductStore};
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

/// A row of `tests/fixtures/products.json` as the file spells it — the
/// committed `createdAt` is Prisma's `TIMESTAMP(3)` text, not a `NaiveDateTime`.
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
    /// Absent for every seeded row; `prod-owned-1` is the one fixture with a
    /// seller, so the store `LEFT JOIN` has something to find.
    owner_id: Option<String>,
}

/// The fixture rows in the order `LIST_QUERY` returns them — `createdAt` then
/// `id`, both ascending — as the struct the handlers serialize.
///
/// One conversion for both consumers, deliberately: [`seed_fixtures`] and the
/// byte-compared goldens have to describe the same rows, so neither may hold its
/// own mapping. `products.json` keeps whatever number spelling a human finds
/// natural; `price` is an `f64` from here on, and `js_number` decides the wire
/// form, so `18` and `18.0` cannot become a golden diff.
///
/// `store_name` is filled the way the `LEFT JOIN` fills it, from the one fixture
/// seller: null for an ownerless row, the seller's name for an owned one.
pub fn fixture_products() -> Vec<Product> {
    let fixtures: Vec<FixtureProduct> =
        serde_json::from_str(include_str!("../fixtures/products.json"))
            .expect("valid product fixture JSON");

    let mut products: Vec<Product> = fixtures
        .into_iter()
        .map(|product| {
            let store_name = product.owner_id.as_ref().map(|_| FIXTURE_STORE_NAME.to_string());
            Product {
                id: product.id,
                title: product.title,
                description: product.description,
                price: product.price,
                currency: product.currency,
                image_url: product.image_url,
                stock: product.stock,
                created_at: parse_timestamp(&product.created_at),
                owner_id: product.owner_id,
                store_name,
            }
        })
        .collect();

    // Mirrors `COLLATE "C"` in LIST_QUERY/LIST_OWNED_QUERY: `String: Ord` is byte
    // order. Every fixture id is lowercase ASCII, so this agrees with a locale
    // collation too — the goldens alone cannot tell the two apart, which is why
    // store/contract.rs pins the tiebreaker directly.
    products.sort_by(|a, b| (a.created_at, &a.id).cmp(&(b.created_at, &b.id)));
    products
}

/// The seller behind the `prod-owned-1` fixture row, and the owner every owned
/// fixture row names. Also the store the byte-compared goldens in
/// `tests/fixtures/` are built from — see `tests/fixtures/mod.rs`.
pub const FIXTURE_STORE_ID: &str = "usr_fixture_store";
pub const FIXTURE_STORE_NAME: &str = "Riverbend Vintage";
/// Created before any product: `Product.ownerId` references it.
pub const FIXTURE_STORE_CREATED_AT: &str = "2026-01-01 00:00:00.000";

pub struct TestStack {
    pub base_url: String,
    pub pool: PgPool,
    pub valkey: Option<ConnectionManager>,
    config: Config,
    /// Extra servers from [`TestStack::serve_with_store`], kept alive so their
    /// ports stay open for the duration of the test.
    extra_servers: std::sync::Mutex<Vec<JoinHandle<()>>>,
    _postgres: ContainerAsync<GenericImage>,
    _valkey: Option<ContainerAsync<GenericImage>>,
    _server: JoinHandle<()>,
}

/// A stand-in read replica: a second database on the same server, holding the
/// same fixtures plus one row the primary does not have.
///
/// This is deliberately not streaming replication. A real replica is
/// byte-identical to the primary apart from lag, and lag is not assertable in a
/// test. What *is* assertable — and what the store code actually decides — is
/// which pool a query is issued against, so the replica database is given
/// distinguishable contents and the marker row becomes the proof.
pub struct ReplicaDatabase {
    pub url: String,
    pub pool: PgPool,
}

/// The row that exists only in the replica database.
pub const REPLICA_ONLY_ID: &str = "replica-only";

const REPLICA_DB: &str = "rnw_replica";

/// A per-test-unique suffix, for the addresses the auth suites register. They all
/// share one throwaway database, and a duplicate registration is a 409 by design.
pub fn unique_suffix() -> String {
    use base64::Engine as _;
    use rand::TryRng as _;
    let mut bytes = [0u8; 6];
    rand::rngs::SysRng
        .try_fill_bytes(&mut bytes)
        .expect("the OS RNG is available in a test binary");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// The stored form of a token, for asserting what the database holds.
pub fn hash_token(token: &str) -> String {
    api_rs::auth::token::hash_token(token)
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
/// query fails. Covers the degraded `/health` body and the contract-compatible
/// 500 a product read returns while the database is down.
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
        Self::start_inner(with_valkey, config_patch, false).await.0
    }

    /// [`TestStack::start`] plus a stand-in replica database, with the store's
    /// read pool pointed at it exactly as `main.rs` does when
    /// `DATABASE_READ_URL` is set.
    pub async fn start_with_read_replica(
        with_valkey: bool,
        config_patch: impl FnOnce(&mut Config),
    ) -> (Self, ReplicaDatabase) {
        let (stack, replica) = Self::start_inner(with_valkey, config_patch, true).await;
        (stack, replica.expect("start_with_read_replica builds a replica"))
    }

    async fn start_inner(
        with_valkey: bool,
        config_patch: impl FnOnce(&mut Config),
        with_read_replica: bool,
    ) -> (Self, Option<ReplicaDatabase>) {
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

        let replica = if with_read_replica {
            Some(ReplicaDatabase::create(&pool, &database_url).await)
        } else {
            None
        };

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
            database_read_url: replica.as_ref().map(|replica| replica.url.clone()),
            valkey_url: None,
            db_max_connections: 5,
            db_read_max_connections: 5,
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
        let store = Arc::new(match &replica {
            // Routed exactly as `main.rs` routes it, so the test covers the
            // real fail-open path rather than a stand-in.
            Some(replica) => match connect_read_replica(
                &replica.url,
                config.db_read_max_connections,
                config.db_acquire_timeout,
            )
            .await
            {
                Some(read) => SqlProductStore::with_read_replica(pool.clone(), read),
                None => SqlProductStore::new(pool.clone()),
            },
            None => SqlProductStore::new(pool.clone()),
        });
        let state = AppState::new(config.clone(), store, valkey.clone(), None);

        let (base_url, server) = spawn_server(state).await;

        let stack = Self {
            base_url,
            pool,
            valkey,
            config,
            extra_servers: std::sync::Mutex::new(Vec::new()),
            _postgres: postgres,
            _valkey: valkey_container,
            _server: server,
        };
        (stack, replica)
    }

    /// An additional server over the *same* database with a caller-supplied
    /// store, for scenarios the standard wiring cannot express — a read pool
    /// that is present but broken, for instance.
    pub async fn serve_with_store(&self, store: Arc<dyn MarketplaceStore>) -> String {
        let state = AppState::new(self.config.clone(), store, self.valkey.clone(), None);
        let (base_url, server) = spawn_server(state).await;
        self.extra_servers.lock().expect("extra server handles").push(server);
        base_url
    }

    /// A pool that is configured but cannot connect, standing in for a replica
    /// that is unreachable in a way that still produced a pool object.
    pub fn broken_read_pool() -> PgPool {
        PgPoolOptions::new()
            .max_connections(1)
            .acquire_timeout(Duration::from_millis(200))
            .connect_lazy("postgresql://rnw:rnw@127.0.0.1:1/rnw_replica")
            .expect("lazy pool for the unreachable replica")
    }
}

impl ReplicaDatabase {
    async fn create(primary: &PgPool, primary_url: &str) -> Self {
        // A literal, not `format!`: sqlx only accepts constant SQL without an
        // explicit injection audit, and the name never varies.
        sqlx::query("CREATE DATABASE rnw_replica")
            .execute(primary)
            .await
            .expect("create the stand-in replica database");
        let (server, _database) =
            primary_url.rsplit_once('/').expect("the test database url has a path");
        let url = format!("{server}/{REPLICA_DB}");
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(5))
            .connect(&url)
            .await
            .expect("connect the replica database");

        apply_migrations(&pool).await;
        seed_fixtures(&pool).await;
        // The marker: identical to a fixture except for the id and price, so a
        // response carrying it can only have come from here.
        insert_product(&pool, REPLICA_ONLY_ID, 424.25).await;

        Self { url, pool }
    }
}

/// Binds an ephemeral port and serves `state` on a background task, returning
/// the base URL plus the join handle that keeps the server alive.
///
/// The list-generation refresher is started here for the same reason `main.rs`
/// starts it: `AppState::new` is synchronous, so a real server needs someone to
/// keep its local view of the shared counter fresh. Without it a second server
/// over the same Valkey would never notice another instance's write.
async fn spawn_server(state: AppState) -> (String, JoinHandle<()>) {
    state.cache.spawn_generation_refresher(state.config.l2_ttl);
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
    // The same embedded set the served binary carries, so the schema under
    // test cannot drift from the committed migrations.
    migrations::run(pool).await.expect("apply embedded migrations");
}

async fn seed_fixtures(pool: &PgPool) {
    // The seller first: `Product.ownerId` references it.
    sqlx::query(
        r#"INSERT INTO "User" ("id", "email", "passwordHash", "storeName", "createdAt") VALUES ($1, $2, $3, $4, $5)"#,
    )
    .bind(FIXTURE_STORE_ID)
    .bind("fixture-store@rnw.test")
    // Not a hash anything logs in with: the E2E suites register their own sellers
    // over HTTP. This row exists only so the `LEFT JOIN` resolves.
    .bind("$argon2id$fixture-not-a-real-hash")
    .bind(FIXTURE_STORE_NAME)
    .bind(parse_timestamp(FIXTURE_STORE_CREATED_AT))
    .execute(pool)
    .await
    .expect("insert fixture seller");

    // The same rows the goldens in `tests/fixtures/` are derived from, through
    // the same conversion — so a golden and the database cannot describe
    // different products.
    for product in fixture_products() {
        sqlx::query(
            r#"INSERT INTO "Product" ("id", "title", "description", "price", "currency", "imageUrl", "stock", "createdAt", "ownerId") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"#,
        )
        .bind(product.id)
        .bind(product.title)
        .bind(product.description)
        .bind(product.price)
        .bind(product.currency)
        .bind(product.image_url)
        .bind(product.stock)
        .bind(product.created_at)
        .bind(product.owner_id)
        .execute(pool)
        .await
        .expect("insert fixture product");
    }
}

/// The committed `createdAt` spelling, which is Prisma's `TIMESTAMP(3)` text
/// rather than chrono output — the same parse the `TIMESTAMP(3)` column needs.
pub fn parse_timestamp(raw: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(raw, "%Y-%m-%d %H:%M:%S%.3f").expect("fixture timestamp")
}

/// One row shaped exactly like a fixture. The replica marker uses this so the
/// only thing distinguishing it is its id and price.
async fn insert_product(pool: &PgPool, id: &str, price: f64) {
    sqlx::query(
        r#"INSERT INTO "Product" ("id", "title", "description", "price", "currency", "imageUrl", "stock", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"#,
    )
    .bind(id)
    .bind("Replica only")
    .bind(None::<String>)
    .bind(price)
    .bind("USD")
    .bind(None::<String>)
    .bind(0_i32)
    .bind(NaiveDateTime::parse_from_str("2026-01-01 00:00:00.000", "%Y-%m-%d %H:%M:%S%.3f")
        .expect("marker timestamp"))
    .execute(pool)
    .await
    .expect("insert replica-only marker product");
}
