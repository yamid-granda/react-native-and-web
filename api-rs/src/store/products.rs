use std::time::Instant;

use chrono::NaiveDateTime;
use sqlx::pool::PoolConnection;
use sqlx::{FromRow, PgPool, Postgres};

/// Mirrors `ProductsService` (`api/src/products/products.service.ts`): the
/// page size fixed at 20, `createdAt ASC, id ASC` ordering (id tiebreaker for
/// bulk-seeded rows sharing a timestamp), and a separate `COUNT(*)`.
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
    /// Returns the page items plus the total row count.
    async fn list_page(&self, offset: i64, limit: i64) -> Result<(Vec<Product>, i64), StoreError>;
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
const DETAIL_QUERY: &str = r#"SELECT "id", "title", "description", "price", "currency", "imageUrl", "stock", "createdAt" FROM "Product" WHERE "id" = $1"#;

pub struct SqlProductStore {
    pool: PgPool,
}

impl SqlProductStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Explicit acquisition so pool wait time is observable as its own metric
    /// (the proposal's "acquisition time exported" requirement).
    ///
    /// sqlx 0.9 only implements `Executor` for `&mut PgConnection` (and for
    /// `&Pool`), never for `&PoolConnection`, so every query below goes
    /// through `&mut *connection`.
    async fn acquire(&self) -> Result<PoolConnection<Postgres>, StoreError> {
        let started = Instant::now();
        let connection = self.pool.acquire().await?;
        metrics::histogram!("sqlx_pool_acquire_seconds").record(started.elapsed().as_secs_f64());
        Ok(connection)
    }
}

#[async_trait::async_trait]
impl ProductStore for SqlProductStore {
    async fn list_page(&self, offset: i64, limit: i64) -> Result<(Vec<Product>, i64), StoreError> {
        let mut connection = self.acquire().await?;
        let rows: Vec<ProductRow> =
            sqlx::query_as(LIST_QUERY).bind(limit).bind(offset).fetch_all(&mut *connection).await?;
        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM \"Product\"")
            .fetch_one(&mut *connection)
            .await?;
        Ok((rows.into_iter().map(Product::from).collect(), total))
    }

    async fn find_by_id(&self, id: &str) -> Result<Option<Product>, StoreError> {
        let mut connection = self.acquire().await?;
        let row: Option<ProductRow> =
            sqlx::query_as(DETAIL_QUERY).bind(id).fetch_optional(&mut *connection).await?;
        Ok(row.map(Product::from))
    }

    async fn ping(&self) -> Result<(), StoreError> {
        let mut connection = self.acquire().await?;
        // Same probe terminus's PrismaHealthIndicator ends up running.
        sqlx::query("SELECT 1").execute(&mut *connection).await?;
        Ok(())
    }
}
