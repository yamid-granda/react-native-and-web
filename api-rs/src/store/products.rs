use std::time::Duration;
use std::time::Instant;

use chrono::NaiveDateTime;
use sqlx::pool::PoolConnection;
use sqlx::postgres::PgPoolOptions;
use sqlx::{FromRow, PgPool, Postgres};

/// The marketplace list contract: the page size fixed at 20, `createdAt ASC,
/// id ASC` ordering (id tiebreaker for bulk-seeded rows sharing a timestamp),
/// and a separate `COUNT(*)`.
///
/// The ordering tuple is not free: it is backed by
/// `Product_createdAt_id_idx` (`@@index([createdAt, id])`). Without that index
/// Postgres sorts the whole table for every page before `LIMIT` can apply.
pub const PAGE_SIZE: i64 = 20;

#[derive(Clone, Debug, PartialEq)]
pub struct Product {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub price: f64,
    pub currency: String,
    pub image_url: Option<String>,
    pub stock: i32,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Database(String),
}

impl From<sqlx::Error> for StoreError {
    fn from(error: sqlx::Error) -> Self {
        Self::Database(error.to_string())
    }
}

#[async_trait::async_trait]
pub trait ProductStore: Send + Sync + 'static {
    /// The rows for one page. The total row count is deliberately a separate
    /// call: it is per-catalog rather than per-page, so the handler caches it
    /// instead of recomputing it on every request.
    async fn list_page(&self, offset: i64, limit: i64) -> Result<Vec<Product>, StoreError>;
    /// `COUNT(*)` over the whole catalog — the `total` the envelope requires.
    async fn count(&self) -> Result<i64, StoreError>;
    async fn find_by_id(&self, id: &str) -> Result<Option<Product>, StoreError>;
    async fn ping(&self) -> Result<(), StoreError>;
}

#[derive(FromRow)]
struct ProductRow {
    id: String,
    title: String,
    description: Option<String>,
    price: f64,
    currency: String,
    #[sqlx(rename = "imageUrl")]
    image_url: Option<String>,
    stock: i32,
    #[sqlx(rename = "createdAt")]
    created_at: NaiveDateTime,
}

impl From<ProductRow> for Product {
    fn from(row: ProductRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            description: row.description,
            price: row.price,
            currency: row.currency,
            image_url: row.image_url,
            stock: row.stock,
            created_at: row.created_at,
        }
    }
}

/// Both statements are `&'static str` on purpose: sqlx 0.9 only accepts
/// literal SQL without an explicit injection audit, and since the column list
/// never varies there is nothing to interpolate — building them with `format!`
/// would only allocate once per query.
const LIST_QUERY: &str = r#"SELECT "id", "title", "description", "price", "currency", "imageUrl", "stock", "createdAt" FROM "Product" ORDER BY "createdAt" ASC, "id" ASC LIMIT $1 OFFSET $2"#;
// Not a raw string: this one *ends* in a `"`, and in `r#"…"#` that quote would
// pair with the `#` and become the terminator — leaving the identifier
// unclosed. The two queries above get away with `r#"…"#` only because neither
// ends in a quote.
const COUNT_QUERY: &str = "SELECT COUNT(*) FROM \"Product\"";
const DETAIL_QUERY: &str = r#"SELECT "id", "title", "description", "price", "currency", "imageUrl", "stock", "createdAt" FROM "Product" WHERE "id" = $1"#;

/// Connects the optional read replica.
///
/// Fail-open, for the same reason Valkey is: a bad `DATABASE_READ_URL` must
/// degrade to primary reads, never stop the service. `None` means "no replica",
/// which the store treats exactly like the pre-replica case.
///
/// Replica lag is the documented hazard — a just-created product can briefly be
/// missing from the replica. That is only acceptable while products are
/// immutable once visible; it becomes a correctness problem the moment
/// `POST /products` exists, which is why the write-path section in
/// `ARCHITECTURE.md` has to be read alongside this.
pub async fn connect_read_replica(
    url: &str,
    max_connections: u32,
    acquire_timeout: Duration,
) -> Option<PgPool> {
    let result = PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(acquire_timeout)
        .connect(url)
        .await;
    match result {
        Ok(pool) => Some(pool),
        Err(error) => {
            tracing::warn!(error = %error, "read replica unreachable; reads staying on the primary");
            None
        }
    }
}

pub struct SqlProductStore {
    /// The primary. Serves `ping` unconditionally, so `/health` keeps detecting
    /// a dead primary even when reads are routed elsewhere.
    pool: PgPool,
    /// An optional read replica. `None` means every query goes to the primary,
    /// which is exactly the behaviour from before this field existed — so local
    /// dev, CI, and the hermetic suite need no replica.
    read_pool: Option<PgPool>,
}

impl SqlProductStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool, read_pool: None }
    }

    pub fn with_read_replica(primary: PgPool, read: PgPool) -> Self {
        Self { pool: primary, read_pool: Some(read) }
    }

    /// Where reads go. Reads are the only workload this service has, so a
    /// replica takes all of them.
    fn reads(&self) -> &PgPool {
        self.read_pool.as_ref().unwrap_or(&self.pool)
    }

    /// Metric label for the pool a query actually acquired from. Reports
    /// `primary` until a replica is configured, so the dashboard never shows a
    /// phantom read pool.
    fn read_role(&self) -> &'static str {
        match self.read_pool {
            Some(_) => "read",
            None => "primary",
        }
    }

    /// Explicit acquisition so pool wait time is observable as its own metric
    /// (the proposal's "acquisition time exported" requirement).
    ///
    /// sqlx 0.9 only implements `Executor` for `&mut PgConnection` (and for
    /// `&Pool`), never for `&PoolConnection`, so every query below goes
    /// through `&mut *connection`.
    async fn acquire(
        pool: &PgPool,
        role: &'static str,
    ) -> Result<PoolConnection<Postgres>, StoreError> {
        let started = Instant::now();
        let connection = pool.acquire().await?;
        // The `pool` label is additive: existing `sum by (le)` queries keep
        // working and now cover both pools at once.
        metrics::histogram!("sqlx_pool_acquire_seconds", "pool" => role)
            .record(started.elapsed().as_secs_f64());
        Ok(connection)
    }
}

#[async_trait::async_trait]
impl ProductStore for SqlProductStore {
    async fn list_page(&self, offset: i64, limit: i64) -> Result<Vec<Product>, StoreError> {
        let mut connection = Self::acquire(self.reads(), self.read_role()).await?;
        let rows: Vec<ProductRow> =
            sqlx::query_as(LIST_QUERY).bind(limit).bind(offset).fetch_all(&mut *connection).await?;
        Ok(rows.into_iter().map(Product::from).collect())
    }

    async fn count(&self) -> Result<i64, StoreError> {
        let mut connection = Self::acquire(self.reads(), self.read_role()).await?;
        let total: i64 = sqlx::query_scalar(COUNT_QUERY).fetch_one(&mut *connection).await?;
        Ok(total)
    }

    async fn find_by_id(&self, id: &str) -> Result<Option<Product>, StoreError> {
        let mut connection = Self::acquire(self.reads(), self.read_role()).await?;
        let row: Option<ProductRow> =
            sqlx::query_as(DETAIL_QUERY).bind(id).fetch_optional(&mut *connection).await?;
        Ok(row.map(Product::from))
    }

    async fn ping(&self) -> Result<(), StoreError> {
        let mut connection = Self::acquire(&self.pool, "primary").await?;
        // One round trip against the primary, so a cold connection shows up as
        // a failed health check rather than a silent success. Deliberately not
        // the read pool: a lagging but reachable replica must not mask a dead
        // primary.
        sqlx::query("SELECT 1").execute(&mut *connection).await?;
        Ok(())
    }
}
